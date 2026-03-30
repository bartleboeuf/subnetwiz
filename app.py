import logging
import os
import re
import atexit
from functools import wraps, lru_cache
from flask import Flask, jsonify, send_from_directory, request
from flask_cors import CORS
from flask_caching import Cache
import boto3
from botocore.config import Config
from botocore.exceptions import ClientError, BotoCoreError
from ipaddress import ip_network, ip_address
from collections import defaultdict
from dotenv import load_dotenv
import concurrent.futures

load_dotenv()

app = Flask(__name__, static_folder='frontend/build', static_url_path='')
CORS(app)

# Configure caching
cache = Cache(app, config={
    'CACHE_TYPE': 'simple',
    'CACHE_DEFAULT_TIMEOUT': 300
})

# Configure minimal logging - only errors and warnings (must be before partition detection)
logging.basicConfig(
    level=logging.WARNING,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Suppress verbose logs
for module in ['boto3', 'botocore', 'urllib3', 'werkzeug']:
    logging.getLogger(module).setLevel(logging.WARNING)

# AWS Partition Detection & Region Selection
PARTITION_DEFAULT_REGIONS = {
    'aws': 'us-east-1',           # Standard AWS (Commercial)
    'aws-cn': 'cn-north-1',       # AWS China
    'aws-us-gov': 'us-gov-west-1',  # AWS GovCloud (US Government)
    'aws-iso': 'us-iso-east-1',   # AWS ISO (Intelligence Community)
    'aws-isob': 'us-isob-east-1', # AWS ISOB (Department of Defense)
    'aws-eusc': 'eusc-de-east-1', # AWS EU Sovereign Cloud (EU - in development)
}

PARTITION_NAMES = {
    'aws': 'Standard AWS (Commercial)',
    'aws-cn': 'AWS China',
    'aws-us-gov': 'AWS GovCloud (US Government)',
    'aws-iso': 'AWS ISO (Intelligence Community)',
    'aws-isob': 'AWS ISOB (Department of Defense)',
    'aws-eusc': 'AWS EU Sovereign Cloud',
}


def detect_partition_from_region(region):
    """Detect AWS partition from region name"""
    if region.startswith('cn-'):
        return 'aws-cn'
    elif region.startswith('us-gov-'):
        return 'aws-us-gov'
    elif region.startswith('us-iso-'):
        return 'aws-isob' if region == 'us-isob-east-1' else 'aws-iso'
    elif region.startswith('eusc-'):
        return 'aws-eusc'
    else:
        return 'aws'  # default partition


def detect_partition_and_region():
    """
    Detect AWS partition and select appropriate default region.

    Supported Partitions:
    - aws: Standard AWS (default: us-east-1) - 32+ regions
    - aws-cn: AWS China (default: cn-north-1) - 2 regions
    - aws-us-gov: AWS GovCloud (default: us-gov-west-1) - 2 regions
    - aws-iso: AWS ISO (default: us-iso-east-1) - 2 regions
    - aws-isob: AWS ISOB (default: us-isob-east-1) - 1 region
    - aws-eusc: AWS EU Sovereign Cloud (default: eusc-de-east-1) - In development
    """
    # Check for explicit override
    if 'AWS_DEFAULT_REGION' in os.environ:
        return os.getenv('AWS_DEFAULT_REGION')

    try:
        # Create session with explicit profile if AWS_PROFILE is set
        profile_name = os.getenv('AWS_PROFILE')
        if profile_name:
            logger.debug(f"Creating boto3 Session with AWS_PROFILE: {profile_name}")
            session = boto3.Session(profile_name=profile_name)
        else:
            session = boto3.Session()

        current_region = boto3.session.Session().region_name
        current_partition = session.get_partition_for_region(current_region)
        logger.debug(f"partition is {current_partition} for region {current_region}")
        if current_partition in PARTITION_DEFAULT_REGIONS:
            default_region = PARTITION_DEFAULT_REGIONS[current_partition]
            logger.info(f"Detected AWS partition '{current_partition}', using default region: {default_region}")
            return default_region

        # If no partition detected, try to query actual regions to determine partition
        logger.warning("No partition detected from get_available_partitions(), trying to query regions...")
        for test_partition, test_region in PARTITION_DEFAULT_REGIONS.items():
            try:
                ec2_client = session.client('ec2', region_name=test_region)
                # Try a simple API call to see if this partition works
                ec2_client.describe_regions(MaxResults=1)
                logger.info(f"Successfully queried partition '{test_partition}' using region '{test_region}'")
                return test_region
            except Exception as region_error:
                logger.debug(f"Partition '{test_partition}' region '{test_region}' failed: {str(region_error)}")
                continue

        # Fallback to standard AWS if no partition detected
        logger.warning("Could not detect AWS partition, defaulting to 'aws' partition with region 'us-east-1'")
        return 'us-east-1'
    except Exception as e:
        logger.warning(f"Could not detect partition, using default region 'us-east-1': {str(e)}")
        return 'us-east-1'


DEFAULT_REGION = detect_partition_and_region()
PREFIX_SIZE = 16  # /28 block size for EKS prefix delegation
MAX_POOL_CONNECTIONS = 50
MAX_RETRY_ATTEMPTS = 3
CACHE_TTL_REGIONS = 3600  # 1 hour
CACHE_TTL_VPCS = 300  # 5 minutes
REQUEST_TIMEOUT = 30
PAGINATION_LIMIT_MIN = 100
PAGINATION_LIMIT_MAX = 10000
PAGINATION_LIMIT_DEFAULT = 5000
AWS_ID_MAX_LENGTH = 100


def log_aws_environment():
    """Log AWS environment info for debugging credential configuration"""
    # Detect partition
    partition = detect_partition_from_region(DEFAULT_REGION)

    is_fargate = 'AWS_EXECUTION_ROLE_ARN' in os.environ
    is_ecs = 'ECS_CONTAINER_METADATA_URI' in os.environ or 'ECS_CONTAINER_METADATA_URI_V4' in os.environ

    if is_fargate:
        logger.debug(f"Running on AWS Fargate with role: {os.environ.get('AWS_EXECUTION_ROLE_ARN', 'N/A')}")
    elif is_ecs:
        logger.debug("Running on AWS ECS with task role credentials")
    else:
        # Check for local credential sources
        if 'AWS_ACCESS_KEY_ID' in os.environ:
            logger.debug("Using explicit AWS credentials from environment variables")
        elif 'AWS_PROFILE' in os.environ:
            logger.debug(f"Using AWS profile: {os.environ.get('AWS_PROFILE', 'default')}")
        else:
            logger.debug("Using default credential chain (IAM role, ~/.aws/credentials, or instance role)")

    logger.debug(f"AWS Partition: {partition} ({PARTITION_NAMES.get(partition, 'Unknown')})")
    logger.debug(f"Default region: {DEFAULT_REGION}")


log_aws_environment()

# AWS client session management with connection pooling
class AWSClientManager:
    """
    Manages boto3 sessions and clients with connection pooling and parallel execution.

    Features:
    - Per-region session caching to reuse connections
    - Connection pooling (50 max connections)
    - Thread pool executor for parallel AWS API calls
    - Adaptive retry strategy for transient failures
    """
    _sessions = {}
    _executor = concurrent.futures.ThreadPoolExecutor(max_workers=5)

    @classmethod
    def get_ec2_client(cls, region=None):
        """Get EC2 client for the specified region with connection pooling"""
        region = region or DEFAULT_REGION

        if region not in cls._sessions:
            config = Config(
                max_pool_connections=MAX_POOL_CONNECTIONS,
                retries={'max_attempts': MAX_RETRY_ATTEMPTS, 'mode': 'adaptive'}
            )
            session = boto3.Session()
            cls._sessions[region] = session.client('ec2', region_name=region, config=config)

        return cls._sessions[region]

    @classmethod
    def get_executor(cls):
        """Get thread executor for parallel AWS API calls"""
        return cls._executor


def validate_region(region):
    """Validate that region follows AWS naming convention"""
    if not region or not isinstance(region, str):
        return False
    # Region names follow pattern: [a-z]{2}-[a-z]+-\d+ (e.g., us-east-1, cn-north-1)
    return re.match(r'^[a-z]{2}-[a-z]+-\d+$', region) is not None or region in PARTITION_DEFAULT_REGIONS.values()


def get_region_from_request():
    """Extract and validate region from request query parameters or headers"""
    region = request.args.get('region') or request.headers.get('X-AWS-Region') or DEFAULT_REGION

    if not validate_region(region):
        logger.warning(f"Invalid region format: {region}")
        return DEFAULT_REGION

    return region


def validate_aws_id(value, id_type):
    """
    Validate AWS resource ID format to prevent injection attacks.

    Args:
        value: The ID to validate (vpc-xxx, subnet-xxx, etc.)
        id_type: Type of ID ('vpc', 'subnet', 'eni') for better error messages

    Returns:
        True if valid, False otherwise
    """
    if not value or not isinstance(value, str):
        return False
    if len(value) > AWS_ID_MAX_LENGTH:
        return False
    if id_type and not value.startswith(id_type + '-'):
        return False
    if not re.match(r'^[a-z0-9\-]+$', value):
        return False
    return True


def handle_aws_error(e, operation_name):
    """Handle AWS API errors with logging and user-friendly messages"""
    if isinstance(e, ClientError):
        error_code = e.response['Error']['Code']
        error_message = e.response['Error']['Message']

        if error_code == 'UnauthorizedOperation':
            logger.error(f"{operation_name}: IAM permission denied - {error_message}")
            return {'error': 'Permission denied', 'code': error_code}, 403
        elif error_code == 'RequestLimitExceeded':
            logger.error(f"{operation_name}: AWS rate limit exceeded")
            return {'error': 'AWS API rate limit exceeded. Please try again later.', 'code': error_code}, 429
        elif error_code in ['ServiceUnavailable', 'InternalFailure', 'RequestExpired']:
            logger.error(f"{operation_name}: AWS service error - {error_code}")
            return {'error': 'AWS service temporarily unavailable', 'code': error_code}, 503
        else:
            logger.error(f"{operation_name}: AWS API error - {error_code}: {error_message}")
            return {'error': error_message, 'code': error_code}, 400

    elif isinstance(e, BotoCoreError):
        logger.error(f"{operation_name}: Connection error - {str(e)}")
        return {'error': 'Connection error with AWS API', 'message': str(e)}, 500

    else:
        logger.error(f"{operation_name}: Unexpected error - {str(e)}")
        return {'error': 'Internal server error', 'message': str(e)}, 500


def endpoint_error_handler(operation_name):
    """Decorator to handle common errors across all endpoints with consistent responses"""
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            try:
                return f(*args, **kwargs)
            except concurrent.futures.TimeoutError:
                logger.error(f"Timeout in {operation_name}")
                return jsonify({'error': 'Request timeout while fetching AWS data'}), 504
            except IndexError:
                logger.error(f"Resource not found in {operation_name}")
                return jsonify({'error': 'Resource not found'}), 404
            except ValueError as e:
                logger.error(f"Invalid parameters in {operation_name}: {str(e)}")
                return jsonify({'error': 'Invalid parameters'}), 400
            except (ClientError, BotoCoreError) as e:
                error_response, status_code = handle_aws_error(e, operation_name)
                return jsonify(error_response), status_code
            except Exception as e:
                logger.error(f"Unexpected error in {operation_name}: {str(e)}", exc_info=True)
                return jsonify({'error': str(e)}), 500
        return wrapper
    return decorator


def fetch_subnet_and_enis_parallel(ec2_client, vpc_id=None, subnet_ids=None):
    """Fetch subnets and ENIs in parallel with timeout handling"""
    executor = AWSClientManager.get_executor()

    if subnet_ids:
        subnet_future = executor.submit(
            ec2_client.describe_subnets,
            SubnetIds=subnet_ids
        )
    else:
        subnet_future = executor.submit(
            ec2_client.describe_subnets,
            Filters=[{'Name': 'vpc-id', 'Values': [vpc_id]}]
        )

    eni_filter = 'vpc-id' if vpc_id else 'subnet-id'
    filter_values = [vpc_id] if vpc_id else subnet_ids
    eni_future = executor.submit(
        ec2_client.describe_network_interfaces,
        Filters=[{'Name': eni_filter, 'Values': filter_values}]
    )

    return (
        subnet_future.result(timeout=REQUEST_TIMEOUT),
        eni_future.result(timeout=REQUEST_TIMEOUT)
    )


def validate_pagination_params(request_args):
    """Extract and validate pagination parameters from request"""
    limit = request_args.get('limit', PAGINATION_LIMIT_DEFAULT, type=int)
    offset = request_args.get('offset', 0, type=int)

    limit = min(limit, PAGINATION_LIMIT_MAX)
    limit = max(limit, PAGINATION_LIMIT_MIN)
    offset = max(offset, 0)

    return limit, offset


def prepare_ip_data_for_subnet(ec2_client, subnet_id, subnet, enis_response):
    """Process ENIs and prepare all IP data structures in one call"""
    cidr_block = subnet['CidrBlock']
    subnet_ip_details = get_all_eni_ips(enis_response['NetworkInterfaces'])
    ip_details_map = {
        ip_info['ip']: ip_info
        for ip_info in subnet_ip_details.get(subnet_id, [])
    }
    reserved_ips = get_reserved_ips(cidr_block)
    cidr_reservation_ips = get_subnet_cidr_reservations(ec2_client, subnet_id)

    return {
        'cidr_block': cidr_block,
        'ip_details_map': ip_details_map,
        'reserved_ips': reserved_ips,
        'cidr_reservation_ips': cidr_reservation_ips,
        'subnet_ip_details': subnet_ip_details
    }


@lru_cache(maxsize=256)
def get_partition_for_region(region):
    """Cache partition detection results"""
    return detect_partition_from_region(region)


def get_reserved_ips(cidr_block):
    """AWS reserves first 4 and last IP in each subnet"""
    network = ip_network(cidr_block)
    reserved = set()

    # First 4 IPs (.0, .1, .2, .3) and last IP (broadcast)
    reserved.add(str(network.network_address))
    reserved.add(str(network.network_address + 1))
    reserved.add(str(network.network_address + 2))
    reserved.add(str(network.network_address + 3))
    reserved.add(str(network.broadcast_address))

    return reserved


def get_subnet_cidr_reservations(ec2_client, subnet_id):
    """
    Get CIDR reservations for a subnet (explicit and prefix-based).

    Handles both reservation types:
    - 'explicit': User-reserved CIDR blocks (e.g., for planned infrastructure)
    - 'prefix': Prefix delegation blocks (e.g., /28 EKS blocks)

    Returns:
        dict: Maps each reserved IP address -> reservation details
              (cidr, type, description, reservationId)
    """
    try:
        response = ec2_client.get_subnet_cidr_reservations(SubnetId=subnet_id)

        reservation_ips = {}
        for reservation in response.get('SubnetIpv4CidrReservations', []):
            cidr = reservation['Cidr']
            reservation_type = reservation['ReservationType']  # 'explicit' or 'prefix'
            description = reservation.get('Description', '')
            reservation_id = reservation['SubnetCidrReservationId']

            logger.debug(f"Found CIDR reservation: {cidr} ({reservation_type}) - {description}")

            # Get all IPs in the reserved CIDR block
            try:
                reserved_network = ip_network(cidr)
                for ip in reserved_network:
                    reservation_ips[str(ip)] = {
                        'cidr': cidr,
                        'type': reservation_type,
                        'description': description,
                        'reservationId': reservation_id
                    }
            except Exception as e:
                logger.error(f"Error processing reservation CIDR {cidr}: {str(e)}")

        return reservation_ips
    except Exception as e:
        logger.error(f"Error fetching subnet CIDR reservations: {str(e)}")
        return {}


def get_all_eni_ips(enis):
    """
    Extract all IPs from ENIs including:
    - Primary private IPs (one per ENI)
    - Secondary private IPs (used by EKS pods without dedicated ENIs)
    - IPs from IPv4 prefixes (prefix delegation /28 blocks for EKS)

    Returns a dict mapping subnet_id -> list of IP details.
    Each IP detail includes: ip, type, status, description, interfaceId, attachmentStatus

    Optimized with batch operations to minimize allocations.
    """
    subnet_ips = defaultdict(list)

    for eni in enis:
        subnet_id = eni['SubnetId']
        interface_id = eni['NetworkInterfaceId']
        description = eni.get('Description', '')
        status = eni['Status']
        attachment_status = eni.get('Attachment', {}).get('Status', 'detached')

        # Batch append private IPs (primary and secondary)
        private_ips = [
            {
                'ip': ip_info['PrivateIpAddress'],
                'type': 'primary' if ip_info.get('Primary', False) else 'secondary',
                'status': status,
                'description': description,
                'interfaceId': interface_id,
                'attachmentStatus': attachment_status
            }
            for ip_info in eni.get('PrivateIpAddresses', [])
        ]
        subnet_ips[subnet_id].extend(private_ips)

        # Get IPs from IPv4 prefixes (EKS prefix delegation)
        for prefix in eni.get('Ipv4Prefixes', []):
            prefix_cidr = prefix['Ipv4Prefix']
            logger.debug(f"Found IPv4 prefix: {prefix_cidr} on ENI {interface_id}")

            # Each prefix is typically a /28 (16 IPs) assigned to the ENI
            # Pods will use IPs from this prefix
            try:
                prefix_network = ip_network(prefix_cidr)
                prefix_ips = [
                    {
                        'ip': str(ip),
                        'type': 'prefix_delegation',
                        'status': 'prefix',
                        'description': f"{description} (Prefix: {prefix_cidr})",
                        'interfaceId': interface_id,
                        'attachmentStatus': 'prefix_assigned'
                    }
                    for ip in prefix_network.hosts()
                ]
                subnet_ips[subnet_id].extend(prefix_ips)
            except Exception as e:
                logger.error(f"Error processing prefix {prefix_cidr}: {str(e)}")

    return subnet_ips


def build_ip_map(network, ip_details_map, reserved_ips, cidr_reservation_ips, offset=0, limit=None):
    """
    Build IP allocation map for a subnet.

    Args:
        network: IPNetwork object for the subnet
        ip_details_map: Dict mapping IP -> details for in-use IPs
        reserved_ips: Set of AWS reserved IPs
        cidr_reservation_ips: Dict mapping IP -> reservation details
        offset: Start index (for pagination)
        limit: Max IPs to return (None = all)

    Returns:
        List of IP objects with status and details
    """
    ip_list = list(network)

    if limit is not None:
        ip_list = ip_list[offset:offset + limit]

    ip_map = []
    # Get network address for calculating IP position within subnet
    network_addr_int = int(network.network_address)
    broadcast_addr_int = int(network.broadcast_address)

    for ip in ip_list:
        ip_str = str(ip)
        if ip_str in reserved_ips:
            status = 'reserved'
            # Calculate IP position relative to network address (not just last octet)
            ip_int = int(ip)
            ip_offset = ip_int - network_addr_int
            subnet_size = int(network.broadcast_address) - int(network.network_address)

            if ip_offset == 0:
                reason = 'Network Address'
                description = 'First address in subnet. Reserved by AWS.'
            elif ip_offset == 1:
                reason = 'VPC Router'
                description = 'Reserved for VPC router (default gateway). Reserved by AWS.'
            elif ip_offset == 2:
                reason = 'DNS Server'
                description = 'Reserved for Amazon DNS server. IP is base of VPC network range plus two. Reserved by AWS.'
            elif ip_offset == 3:
                reason = 'Reserved for Future Use'
                description = 'Reserved by AWS for future use.'
            elif ip_int == broadcast_addr_int:
                reason = 'Network Broadcast Address'
                description = 'Broadcast address. AWS does not support broadcast in VPCs. Reserved by AWS.'
            else:
                reason = 'AWS Reserved'
                description = 'Reserved by AWS.'
            details = {'reason': reason, 'description': description, 'type': 'aws_reserved'}
        elif ip_str in ip_details_map:
            status = 'used'
            details = ip_details_map[ip_str]
            if ip_str in cidr_reservation_ips:
                details['cidrReservation'] = cidr_reservation_ips[ip_str]
        elif ip_str in cidr_reservation_ips:
            status = 'cidr_reservation'
            details = cidr_reservation_ips[ip_str]
        else:
            status = 'free'
            details = None

        ip_map.append({
            'ip': ip_str,
            'status': status,
            'details': details
        })

    return ip_map


def calculate_fragmentation(used_ips, total_ips, available_count):
    """
    Calculate fragmentation metrics for a subnet optimized for /28 prefix allocation.
    Returns a fragmentation score (0-100) where:
    - 0 = Low fragmentation (can allocate many /28 blocks efficiently)
    - 100 = High fragmentation (most available IPs are wasted in unusable fragments)

    The score measures what percentage of available IPs are in fragments too small
    to fit a /28 block (PREFIX_SIZE IPs). This directly reflects allocation efficiency.
    """

    if total_ips == 0 or available_count == 0:
        return 0, {'num_gaps': 0, 'avg_gap_size': 0, 'largest_gap': 0, 'gaps': [], 'usable_prefixes': 0}

    if len(used_ips) == 0:
        # No IPs used means no fragmentation
        usable_prefixes = available_count // PREFIX_SIZE
        return 0, {
            'num_gaps': 0,
            'avg_gap_size': 0,
            'largest_gap': available_count,
            'gaps': [],
            'usable_prefixes': usable_prefixes
        }

    # Sort used IPs by their integer representation (using generator for memory efficiency)
    sorted_used = sorted((int(ip_address(ip)) for ip in used_ips))

    logger.debug(f"Fragmentation calc: total_ips={total_ips}, available={available_count}, used={len(used_ips)}")
    logger.debug(f"Used IP range: {ip_address(sorted_used[0])} to {ip_address(sorted_used[-1])}")

    # Find all free blocks (gaps between used IPs + edge space)
    gaps = []
    for i in range(len(sorted_used) - 1):
        gap_size = sorted_used[i + 1] - sorted_used[i] - 1
        if gap_size > 0:
            gaps.append(gap_size)

    # Total IPs in gaps between used IPs
    total_gap_ips = sum(gaps)

    # The remaining available IPs are in contiguous blocks outside the used IP range
    edge_free_ips = available_count - total_gap_ips

    # All free blocks = gaps + edge block
    all_free_blocks = gaps + ([edge_free_ips] if edge_free_ips > 0 else [])

    # Calculate how many /28 prefixes can actually be allocated
    usable_prefixes = sum(block // PREFIX_SIZE for block in all_free_blocks)

    # Calculate how many /28 prefixes COULD be allocated if perfectly contiguous
    theoretical_prefixes = available_count // PREFIX_SIZE

    # Calculate wasted IPs (IPs in fragments too small for /28)
    wasted_ips = sum(block % PREFIX_SIZE if block < PREFIX_SIZE else 0
                     for block in all_free_blocks)
    # Add the remainder IPs from blocks that can fit prefixes
    wasted_ips += sum(block % PREFIX_SIZE for block in all_free_blocks if block >= PREFIX_SIZE)

    logger.debug(f"Gaps: {len(gaps)} gaps totaling {total_gap_ips} IPs")
    logger.debug(f"Free blocks: {sorted(all_free_blocks, reverse=True)[:5]}")
    logger.debug(f"Can allocate {usable_prefixes} /28 prefixes (theoretical max: {theoretical_prefixes})")
    logger.debug(f"Wasted IPs: {wasted_ips}/{available_count}")

    # Calculate metrics
    num_free_blocks = len(all_free_blocks)
    largest_free_block = max(all_free_blocks) if all_free_blocks else 0
    avg_block_size = sum(all_free_blocks) / num_free_blocks if num_free_blocks > 0 else 0

    # If all free space is in one block, fragmentation is minimal
    if num_free_blocks <= 1:
        # Still calculate score based on wasted remainder
        waste_percentage = (wasted_ips / available_count) * 100 if available_count > 0 else 0
        return round(waste_percentage, 2), {
            'num_gaps': 0,
            'avg_gap_size': 0,
            'largest_gap': largest_free_block,
            'gaps': [],
            'usable_prefixes': usable_prefixes
        }

    # Fragmentation score: percentage of IPs that can't be used due to fragmentation
    # This accounts for both small fragments AND remainder waste
    if theoretical_prefixes > 0:
        # How many prefixes are lost due to fragmentation?
        lost_prefixes = theoretical_prefixes - usable_prefixes
        fragmentation_score = (lost_prefixes / theoretical_prefixes) * 100
    else:
        # If we can't even fit one /28, fragmentation is maximum
        fragmentation_score = 100

    logger.debug(f"Fragmentation score: {fragmentation_score:.1f}% (lost {theoretical_prefixes - usable_prefixes}/{theoretical_prefixes} possible /28 blocks)")

    return round(fragmentation_score, 2), {
        'num_gaps': len(gaps),
        'avg_gap_size': round(avg_block_size, 2),
        'largest_gap': largest_free_block,
        'gaps': sorted(all_free_blocks, reverse=True)[:10],
        'usable_prefixes': usable_prefixes
    }


@app.route('/')
def serve():
    """Serve the React app"""
    try:
        return send_from_directory(app.static_folder, 'index.html')
    except FileNotFoundError:
        logger.warning("Frontend build not found, falling back to development instruction")
        return jsonify({
            'message': 'Frontend not built yet. Run the Flask API on port 5000 and React dev server on port 3000'
        }), 503


@app.route('/api/regions')
@cache.cached(timeout=CACHE_TTL_REGIONS)
def get_regions():
    """Get all available AWS regions for the detected partition with default region indicator"""
    try:
        # Detect partition from DEFAULT_REGION
        partition = get_partition_for_region(DEFAULT_REGION)
        region_for_api = DEFAULT_REGION

        logger.info(f"get_regions: Using region '{region_for_api}' for partition '{partition}'")

        ec2_client = AWSClientManager.get_ec2_client(region_for_api)
        logger.info(f"get_regions: Created EC2 client for region '{region_for_api}'")

        response = ec2_client.describe_regions(AllRegions=False)
        logger.info(f"get_regions: describe_regions returned {len(response.get('Regions', []))} regions")

        if not response or 'Regions' not in response:
            logger.error(f"get_regions: No regions found in response: {response}")
            return jsonify([])

        regions = [
            {
                'id': region['RegionName'],
                'name': region['RegionName'],
                'endpoint': region['Endpoint'],
                'isDefault': region['RegionName'] == DEFAULT_REGION,
                'partition': partition
            }
            for region in response['Regions']
        ]
        # Sort by region name
        regions.sort(key=lambda x: x['name'])

        logger.info(f"Returned {len(regions)} regions for partition '{partition}': {DEFAULT_REGION}")
        return jsonify(regions)
    except concurrent.futures.TimeoutError:
        logger.error("get_regions: Timeout fetching regions from AWS")
        return jsonify({'error': 'Request timeout while fetching AWS data'}), 504
    except (ClientError, BotoCoreError) as e:
        error_response, status_code = handle_aws_error(e, 'get_regions')
        return jsonify(error_response), status_code
    except Exception as e:
        logger.error(f"get_regions: Unexpected error - {str(e)}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/api/account-info')
def get_account_info():
    """Get AWS account ID and partition information"""
    try:
        region = get_region_from_request()
        ec2_client = AWSClientManager.get_ec2_client(region)
        sts_client = boto3.client('sts', region_name=region)

        # Get account ID from STS
        identity = sts_client.get_caller_identity()
        account_id = identity['Account']

        # Get partition from DEFAULT_REGION
        partition = get_partition_for_region(DEFAULT_REGION)
        partition_names = {
            'aws': 'Standard AWS',
            'aws-cn': 'AWS China',
            'aws-us-gov': 'AWS GovCloud',
            'aws-iso': 'AWS ISO',
            'aws-isob': 'AWS ISOB',
            'aws-eusc': 'AWS EU Sovereign Cloud',
        }

        return jsonify({
            'accountId': account_id,
            'partition': partition,
            'partitionName': partition_names.get(partition, 'Unknown'),
            'region': DEFAULT_REGION
        })
    except (ClientError, BotoCoreError) as e:
        error_response, status_code = handle_aws_error(e, 'get_account_info')
        return jsonify(error_response), status_code
    except Exception as e:
        logger.error(f"get_account_info: Unexpected error - {str(e)}", exc_info=True)
        return jsonify({'error': str(e)}), 500


@app.route('/api/vpcs')
@cache.cached(timeout=CACHE_TTL_VPCS, query_string=True)
@endpoint_error_handler('get_vpcs')
def get_vpcs():
    """Get all VPCs in the account for the specified region"""
    region = get_region_from_request()
    ec2_client = AWSClientManager.get_ec2_client(region)
    response = ec2_client.describe_vpcs()
    vpcs = []

    for vpc in response['Vpcs']:
        name = next((tag['Value'] for tag in vpc.get('Tags', [])
                    if tag['Key'] == 'Name'), vpc['VpcId'])
        vpcs.append({
            'id': vpc['VpcId'],
            'name': name,
            'cidr': vpc['CidrBlock'],
            'state': vpc['State']
        })

    return jsonify(vpcs)


@app.route('/api/vpc/<vpc_id>/subnets')
@endpoint_error_handler('get_subnets')
def get_subnets(vpc_id):
    """Get all subnets for a VPC with usage statistics"""
    # Validate VPC ID format
    if not validate_aws_id(vpc_id, 'vpc'):
        logger.warning(f"Invalid VPC ID format: {vpc_id}")
        return jsonify({'error': 'Invalid VPC ID format'}), 400

    region = get_region_from_request()
    ec2_client = AWSClientManager.get_ec2_client(region)

    # Fetch subnets and ENIs in parallel for better performance
    subnets_response, enis_response = fetch_subnet_and_enis_parallel(
        ec2_client, vpc_id=vpc_id
    )

    subnets = []
    for subnet in subnets_response['Subnets']:
        if subnet.get('Ipv6Native', False):
            continue

        subnet_id = subnet['SubnetId']
        name = next((tag['Value'] for tag in subnet.get('Tags', [])
                    if tag['Key'] == 'Name'), subnet_id)

        # Extract all tags from the subnet
        tags = [{'key': tag['Key'], 'value': tag['Value']} for tag in subnet.get('Tags', [])]

        # Prepare all IP data for this subnet
        ip_data = prepare_ip_data_for_subnet(ec2_client, subnet_id, subnet, enis_response)
        cidr_block = ip_data['cidr_block']
        ip_details_map = ip_data['ip_details_map']
        reserved_ips = ip_data['reserved_ips']
        cidr_reservation_ips = ip_data['cidr_reservation_ips']
        subnet_ip_details = ip_data['subnet_ip_details']

        # Calculate IP usage
        network = ip_network(cidr_block)
        total_ips = network.num_addresses
        available_ips = subnet['AvailableIpAddressCount']

        # Get used IPs and prepare fragmentation data
        ip_details = subnet_ip_details.get(subnet_id, [])
        used_ips = [ip_info['ip'] for ip_info in ip_details]
        cidr_reservations_list = list(cidr_reservation_ips.keys())
        all_unavailable_ips = used_ips + cidr_reservations_list

        # Calculate fragmentation
        logger.info(f"=== Calculating fragmentation for subnet: {name} ({subnet_id}) ===")
        frag_score, frag_details = calculate_fragmentation(
            all_unavailable_ips, total_ips, available_ips
        )

        # Count different IP types (single pass optimization)
        type_counts = defaultdict(int)
        for ip in ip_details:
            type_counts[ip['type']] += 1

        # Extract unique CIDR reservation blocks for summary
        reservation_blocks = {}
        for _, res_info in cidr_reservation_ips.items():
            res_cidr = res_info['cidr']
            if res_cidr not in reservation_blocks:
                reservation_blocks[res_cidr] = res_info

        subnets.append({
            'id': subnet_id,
            'name': name,
            'tags': tags,
            'cidr': cidr_block,
            'availabilityZone': subnet['AvailabilityZone'],
            'totalIps': total_ips,
            'availableIps': available_ips,
            'usedIps': len(used_ips),
            'reservedIps': len(reserved_ips),
            'cidrReservationIps': len(cidr_reservations_list),
            'cidrReservations': list(reservation_blocks.values()),
            'primaryIps': type_counts['primary'],
            'secondaryIps': type_counts['secondary'],
            'prefixDelegationIps': type_counts['prefix_delegation'],
            'utilization': round((len(used_ips) / total_ips) * 100, 2) if total_ips > 0 else 0,
            'fragmentationScore': frag_score,
            'fragmentationDetails': frag_details
        })

    return jsonify(subnets)


@app.route('/api/subnet/<subnet_id>/ips')
@endpoint_error_handler('get_subnet_ips')
def get_subnet_ips(subnet_id):
    """Get detailed IP allocation map for a subnet"""
    # Validate subnet ID format
    if not validate_aws_id(subnet_id, 'subnet'):
        logger.warning(f"Invalid subnet ID format: {subnet_id}")
        return jsonify({'error': 'Invalid subnet ID format'}), 400

    region = get_region_from_request()
    ec2_client = AWSClientManager.get_ec2_client(region)

    # Fetch subnet details and ENIs in parallel
    subnets_response, enis_response = fetch_subnet_and_enis_parallel(
        ec2_client, subnet_ids=[subnet_id]
    )

    subnet = subnets_response['Subnets'][0]

    # Prepare IP data
    ip_data = prepare_ip_data_for_subnet(ec2_client, subnet_id, subnet, enis_response)
    cidr_block = ip_data['cidr_block']
    ip_details_map = ip_data['ip_details_map']
    reserved_ips = ip_data['reserved_ips']
    cidr_reservation_ips = ip_data['cidr_reservation_ips']

    # Build complete IP map
    network = ip_network(cidr_block)
    ip_map = build_ip_map(network, ip_details_map, reserved_ips, cidr_reservation_ips)

    # Calculate statistics
    used_count = sum(1 for ip in ip_map if ip['status'] == 'used')
    free_count = sum(1 for ip in ip_map if ip['status'] == 'free')
    reserved_count = sum(1 for ip in ip_map if ip['status'] == 'reserved')
    cidr_reservation_count = sum(1 for ip in ip_map if ip['status'] == 'cidr_reservation')

    return jsonify({
        'subnetId': subnet_id,
        'cidr': cidr_block,
        'totalIps': len(ip_map),
        'usedIps': used_count,
        'freeIps': free_count,
        'reservedIps': reserved_count,
        'cidrReservationIps': cidr_reservation_count,
        'ips': ip_map
    })


@app.route('/api/subnet/<subnet_id>/ips/paginated')
@endpoint_error_handler('get_subnet_ips_paginated')
def get_subnet_ips_paginated(subnet_id):
    """Get paginated IP allocation map for large subnets"""
    # Validate subnet ID format
    if not validate_aws_id(subnet_id, 'subnet'):
        logger.warning(f"Invalid subnet ID format: {subnet_id}")
        return jsonify({'error': 'Invalid subnet ID format'}), 400

    region = get_region_from_request()
    ec2_client = AWSClientManager.get_ec2_client(region)

    # Get and validate pagination parameters
    limit, offset = validate_pagination_params(request.args)

    # Fetch subnet details and ENIs in parallel
    subnets_response, enis_response = fetch_subnet_and_enis_parallel(
        ec2_client, subnet_ids=[subnet_id]
    )

    subnet = subnets_response['Subnets'][0]

    # Prepare IP data
    ip_data = prepare_ip_data_for_subnet(ec2_client, subnet_id, subnet, enis_response)
    cidr_block = ip_data['cidr_block']
    ip_details_map = ip_data['ip_details_map']
    reserved_ips = ip_data['reserved_ips']
    cidr_reservation_ips = ip_data['cidr_reservation_ips']

    # Build paginated IP map
    network = ip_network(cidr_block)
    total_ips = network.num_addresses
    ip_map = build_ip_map(network, ip_details_map, reserved_ips, cidr_reservation_ips, offset, limit)

    return jsonify({
        'subnetId': subnet_id,
        'cidr': cidr_block,
        'totalIps': total_ips,
        'limit': limit,
        'offset': offset,
        'returned': len(ip_map),
        'ips': ip_map
    })


@app.route('/api/health')
def health():
    """Health check endpoint with AWS environment info"""
    partition = get_partition_for_region(DEFAULT_REGION)

    health_data = {
        'status': 'healthy',
        'service': 'subnetviz',
        'aws': {
            'region': DEFAULT_REGION,
            'partition': partition,
            'fargate': 'AWS_EXECUTION_ROLE_ARN' in os.environ,
            'ecs': 'ECS_CONTAINER_METADATA_URI_V4' in os.environ or 'ECS_CONTAINER_METADATA_URI' in os.environ
        }
    }
    response = jsonify(health_data)
    response.headers['Cache-Control'] = 'no-cache'
    return response


@app.after_request
def add_response_headers(response):
    """Add security and caching headers to responses"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'SAMEORIGIN'

    # Set appropriate cache headers for API responses
    if 'api' in request.path:
        if request.method == 'GET':
            response.headers['Cache-Control'] = 'private, max-age=300'
        else:
            response.headers['Cache-Control'] = 'no-cache, no-store, must-revalidate'

    return response


def cleanup_executor_on_exit():
    """Clean up thread pool executor on process exit (not after each request)"""
    try:
        executor = AWSClientManager.get_executor()
        executor.shutdown(wait=True)
        logger.debug("Thread pool executor shut down gracefully")
    except Exception as e:
        logger.error(f"Error shutting down thread pool executor: {e}")


# Register cleanup to run only on actual app exit, not after each request
atexit.register(cleanup_executor_on_exit)


if __name__ == '__main__':
    port = int(os.getenv('PORT', '5000'))
    debug = os.getenv('FLASK_DEBUG', 'False').lower() == 'true'
    app.run(host='0.0.0.0', port=port, debug=debug)
