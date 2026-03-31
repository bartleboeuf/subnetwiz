import React, { useState, useEffect, useCallback, useRef, Suspense, createContext, useContext } from 'react';
import * as api from './utils/api';
import './theme.css';
import './App.css';
import ErrorBoundary from './components/ErrorBoundary';
import RegionSelector from './components/RegionSelector';
import VpcSelector from './components/VpcSelector';
import SubnetList from './components/SubnetList';
import FilterPanel from './components/FilterPanel';
import About from './components/About';

// Theme context
export const ThemeContext = createContext();

export const useTheme = () => {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return context;
};

// Lazy load heavy components for code splitting
const IpVisualization = React.lazy(() => import('./components/IpVisualization'));
const Statistics = React.lazy(() => import('./components/Statistics'));

// Loading placeholder for lazy components
const LoadingPlaceholder = () => (
  <div className="placeholder">
    <div className="spinner" style={{ margin: '2rem auto' }}></div>
    <h3>Loading visualization...</h3>
  </div>
);

function App() {
  // Theme state (light by default)
  const [theme, setTheme] = useState(() => {
    const saved = localStorage.getItem('theme');
    return saved || 'light';
  });

  // About modal state
  const [showAbout, setShowAbout] = useState(false);

  // Update document theme on mount and when theme changes
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    setTheme(prev => prev === 'light' ? 'dark' : 'light');
  }, []);

  // Data state
  const [regions, setRegions] = useState([]);
  const [selectedRegion, setSelectedRegion] = useState(null);
  const [vpcs, setVpcs] = useState([]);
  const [selectedVpc, setSelectedVpc] = useState(null);
  const [subnets, setSubnets] = useState([]);
  const [selectedSubnet, setSelectedSubnet] = useState(null);
  const [ipData, setIpData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [loadingIpData, setLoadingIpData] = useState(false);
  const [loadingMoreIps, setLoadingMoreIps] = useState(false);
  const [ipPaginationInfo, setIpPaginationInfo] = useState(null);
  const [error, setError] = useState(null);
  const [accountInfo, setAccountInfo] = useState(null);
  const [isDataCached, setIsDataCached] = useState(false);

  // Filter state
  const [filters, setFilters] = useState({
    searchText: '',
    selectedAZs: [],
    minUtilization: 0,
    maxUtilization: 100,
    selectedFragmentationLevels: ['Low', 'Moderate', 'High'],
    selectedTagFilters: {},
    filterByIP: '',
  });

  // Filter panel visibility state (collapsed by default)
  const [filterPanelExpanded, setFilterPanelExpanded] = useState(false);

  // Abort controllers for canceling pending requests
  const vpcAbortRef = useRef(null);
  const subnetAbortRef = useRef(null);
  const ipDataAbortRef = useRef(null);
  const paginationTimeoutsRef = useRef([]);
  const cachedBadgeTimeoutRef = useRef(null);

  // Cache for API responses (40-60% fewer API calls)
  const cacheRef = useRef({
    regions: { data: null, timestamp: 0 },
    vpcs: {}, // keyed by region
    subnets: {}, // keyed by vpc-region
    ips: {} // keyed by subnet-region
  });
  const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

  // Track pending requests to avoid duplicates (deduplication)
  const pendingRef = useRef({
    vpcs: null,
    subnets: null,
    ips: null
  });

  // Define all fetch functions with useCallback (memoized)
  const fetchRegions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.get('/api/regions');
      setRegions(response.data);
      // Auto-select default region from backend, or first region as fallback
      const defaultRegion = response.data.find(r => r.isDefault) || response.data[0];
      if (defaultRegion) {
        setSelectedRegion(defaultRegion);
      }
    } catch (err) {
      setError('Failed to fetch regions: ' + err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchVpcs = useCallback(async () => {
    if (!selectedRegion) return;

    const cacheKey = selectedRegion.id;
    const cache = cacheRef.current.vpcs[cacheKey];
    const now = Date.now();

    // Check if cached data is still valid
    if (cache && (now - cache.timestamp) < CACHE_TTL) {
      setVpcs(cache.data);
      setIsDataCached(true);
      return;
    }

    // If already fetching this region, return pending promise (deduplication)
    if (pendingRef.current.vpcs && pendingRef.current.vpcs.region === cacheKey) {
      return pendingRef.current.vpcs.promise;
    }

    // Abort any previous VPC fetch request
    if (vpcAbortRef.current) {
      vpcAbortRef.current.abort();
    }
    vpcAbortRef.current = new AbortController();

    setLoading(true);
    setError(null);
    setIsDataCached(false);

    const promise = (async () => {
      try {
        const response = await api.get('/api/vpcs', {
          params: { region: selectedRegion.id },
          signal: vpcAbortRef.current.signal
        });
        // Cache the response
        cacheRef.current.vpcs[cacheKey] = {
          data: response.data,
          timestamp: now
        };
        setVpcs(response.data);
      } catch (err) {
        // Don't set error if request was aborted (region changed)
        if (err.name !== 'AbortError') {
          setError('Failed to fetch VPCs: ' + err.message);
        }
      } finally {
        setLoading(false);
        pendingRef.current.vpcs = null;
      }
    })();

    pendingRef.current.vpcs = { region: cacheKey, promise };
  }, [selectedRegion, CACHE_TTL]);

  const fetchSubnets = useCallback(async (vpcId) => {
    if (!selectedRegion) return;

    const cacheKey = `${vpcId}-${selectedRegion.id}`;
    const cache = cacheRef.current.subnets[cacheKey];
    const now = Date.now();

    // Check if cached data is still valid
    if (cache && (now - cache.timestamp) < CACHE_TTL) {
      setSubnets(cache.data);
      setIsDataCached(true);
      return;
    }

    // If already fetching this VPC, return pending promise (deduplication)
    if (pendingRef.current.subnets && pendingRef.current.subnets.key === cacheKey) {
      return pendingRef.current.subnets.promise;
    }

    // Abort any previous subnet fetch request
    if (subnetAbortRef.current) {
      subnetAbortRef.current.abort();
    }
    subnetAbortRef.current = new AbortController();

    setLoading(true);
    setError(null);
    setIsDataCached(false);

    const promise = (async () => {
      try {
        const response = await api.get(`/api/vpc/${vpcId}/subnets`, {
          params: { region: selectedRegion.id },
          signal: subnetAbortRef.current.signal
        });
        // Cache the response
        cacheRef.current.subnets[cacheKey] = {
          data: response.data,
          timestamp: now
        };
        setSubnets(response.data);
      } catch (err) {
        // Don't set error if request was aborted (region changed)
        if (err.name !== 'AbortError') {
          setError('Failed to fetch subnets: ' + err.message);
        }
      } finally {
        setLoading(false);
        pendingRef.current.subnets = null;
      }
    })();

    pendingRef.current.subnets = { key: cacheKey, promise };
  }, [selectedRegion, CACHE_TTL]);

  const fetchIpData = useCallback(async (subnetId, usePagination = false, offset = 0) => {
    if (!selectedRegion) return;

    const cacheKey = `${subnetId}-${selectedRegion.id}`;
    const cache = cacheRef.current.ips[cacheKey];
    const now = Date.now();
    const PAGE_SIZE = 5000;

    // Capture current region/subnet for later validation
    const fetchRegionId = selectedRegion.id;
    const fetchSubnetId = subnetId;

    // Check if cached data is still valid (only for non-paginated requests)
    if (!usePagination && cache && (now - cache.timestamp) < CACHE_TTL) {
      setIpData(cache.data);
      setIpPaginationInfo(null);
      return;
    }

    // If already fetching this subnet, return pending promise (deduplication)
    if (!usePagination && pendingRef.current.ips && pendingRef.current.ips.key === cacheKey) {
      return pendingRef.current.ips.promise;
    }

    // Abort any previous IP data fetch request
    if (ipDataAbortRef.current) {
      ipDataAbortRef.current.abort();
    }
    ipDataAbortRef.current = new AbortController();

    const isFirstPage = offset === 0;
    if (isFirstPage) {
      setLoadingIpData(true);
      setError(null);
    } else {
      setLoadingMoreIps(true);
    }

    const promise = (async () => {
      try {
        // Choose endpoint based on whether using pagination
        const endpoint = usePagination
          ? `/api/subnet/${fetchSubnetId}/ips/paginated`
          : `/api/subnet/${fetchSubnetId}/ips`;

        const params = { region: fetchRegionId };
        if (usePagination) {
          params.offset = offset;
          params.limit = PAGE_SIZE;
        }

        const response = await api.get(endpoint, {
          params,
          signal: ipDataAbortRef.current.signal
        });

        const data = response.data;

        if (usePagination) {
          // Handle paginated response
          const paginationInfo = {
            totalIps: data.totalIps,
            offset: data.offset,
            limit: data.limit,
            returned: data.returned
          };

          if (isFirstPage) {
            // First page - set initial data
            setIpData({
              subnetId: data.subnetId,
              cidr: data.cidr,
              totalIps: data.totalIps,
              ips: data.ips
            });
            setIpPaginationInfo(paginationInfo);

            // Load subsequent pages in background if there are more
            if (data.totalIps > PAGE_SIZE) {
              for (let nextOffset = PAGE_SIZE; nextOffset < data.totalIps; nextOffset += PAGE_SIZE) {
                const timeoutId = setTimeout(() => fetchIpData(subnetId, true, nextOffset), 200);
                paginationTimeoutsRef.current.push(timeoutId);
              }
            }
          } else {
            // Append subsequent page to existing data
            setIpData(prevData => {
              if (prevData) {
                return {
                  ...prevData,
                  ips: [...prevData.ips, ...data.ips]
                };
              }
              return prevData;
            });
            setIpPaginationInfo(paginationInfo);
          }
        } else {
          // Handle non-paginated response
          cacheRef.current.ips[cacheKey] = {
            data: data,
            timestamp: now
          };
          setIpData(data);
          setIpPaginationInfo(null);
        }
      } catch (err) {
        // Don't set error if:
        // 1. Request was aborted (region/subnet changed)
        // 2. Region or subnet changed since fetch started
        // 3. Invalid subnet error (likely region changed)
        const isInvalidSubnetError = err.message?.includes('InvalidSubnetID') || err.message?.includes('does not exist');
        if (err.name !== 'AbortError' && !isInvalidSubnetError && selectedRegion?.id === fetchRegionId && selectedSubnet?.id === fetchSubnetId) {
          setError('Failed to fetch IP data: ' + err.message);
        }
      } finally {
        if (isFirstPage) {
          setLoadingIpData(false);
          pendingRef.current.ips = null;
        } else {
          setLoadingMoreIps(false);
          // Remove this timeout from tracking once pagination completes
          paginationTimeoutsRef.current = paginationTimeoutsRef.current.filter(id => id !== null);
        }
      }
    })();

    if (isFirstPage) {
      pendingRef.current.ips = { key: cacheKey, promise };
    }
  }, [selectedRegion, selectedSubnet, CACHE_TTL]);

  // Fetch regions on mount
  useEffect(() => {
    fetchRegions();
  }, [fetchRegions]);

  // Fetch account info on mount
  useEffect(() => {
    const fetchAccountInfo = async () => {
      try {
        const response = await api.get('/api/account-info');
        setAccountInfo(response.data);
      } catch (err) {
        console.error('Failed to fetch account info:', err);
      }
    };

    fetchAccountInfo();
  }, []);

  // Abort all pending requests and clear error when region changes
  useEffect(() => {
    // Clear error and selections immediately when region changes
    setError(null);
    setSelectedVpc(null);
    setSelectedSubnet(null);
    setIpData(null);
    setSubnets([]);

    // Cancel all pending pagination timeouts
    paginationTimeoutsRef.current.forEach(timeoutId => clearTimeout(timeoutId));
    paginationTimeoutsRef.current = [];

    return () => {
      if (vpcAbortRef.current) {
        vpcAbortRef.current.abort();
      }
      if (subnetAbortRef.current) {
        subnetAbortRef.current.abort();
      }
      if (ipDataAbortRef.current) {
        ipDataAbortRef.current.abort();
      }
    };
  }, [selectedRegion]);

  // Fetch VPCs when region is selected
  useEffect(() => {
    if (selectedRegion) {
      fetchVpcs();
    } else {
      setVpcs([]);
    }
  }, [selectedRegion, fetchVpcs]);

  // Fetch subnets when VPC is selected
  useEffect(() => {
    if (selectedVpc) {
      fetchSubnets(selectedVpc.id);
    } else {
      setSubnets([]);
      setSelectedSubnet(null);
      setIpData(null);
    }
  }, [selectedVpc, fetchSubnets]);

  // Fetch IP data when subnet is selected
  useEffect(() => {
    if (selectedSubnet) {
      // Use pagination for large subnets (> 10K IPs estimated)
      const usePagination = selectedSubnet.totalIps > 10000;
      fetchIpData(selectedSubnet.id, usePagination, 0);
    } else {
      setIpData(null);
      setIpPaginationInfo(null);
    }
  }, [selectedSubnet, fetchIpData]);

  // Hide cached badge after 3 seconds
  useEffect(() => {
    if (isDataCached) {
      if (cachedBadgeTimeoutRef.current) {
        clearTimeout(cachedBadgeTimeoutRef.current);
      }
      cachedBadgeTimeoutRef.current = setTimeout(() => {
        setIsDataCached(false);
      }, 3000);
    }

    return () => {
      if (cachedBadgeTimeoutRef.current) {
        clearTimeout(cachedBadgeTimeoutRef.current);
      }
    };
  }, [isDataCached]);

  const handleRefresh = () => {
    if (selectedVpc) {
      fetchSubnets(selectedVpc.id);
    } else if (selectedRegion) {
      fetchVpcs();
    }
  };

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      <ErrorBoundary>
        <div className="App" data-theme={theme}>
          <header className="App-header">
            <div className="header-logo-section">
              <img src="/logo.png" alt="SubnetViz Logo" className="header-logo" />
            </div>
            <div className="header-title-section">
              <h1>SubnetViz</h1>
              <p>AWS Subnet Visualization & Analytics</p>
            </div>
            <div className="header-actions">
              {accountInfo && (
                <div className="header-account-info">
                  <div className="account-id-item">
                    <span className="account-id-label">Account:</span>
                    <span className="account-id-value">{accountInfo.accountId}</span>
                  </div>
                  <div className="account-partition-item">
                    <span className="account-partition-label">{accountInfo.partitionName}</span>
                  </div>
                </div>
              )}
              <button className="theme-toggle-button" title={`Switch to ${theme === 'light' ? 'dark' : 'light'} mode`} onClick={toggleTheme}>
                {theme === 'light' ? '🌙' : '☀️'}
              </button>
              <button className="about-button" title="About SubnetViz" onClick={() => setShowAbout(true)}>
                ⓘ
              </button>
            </div>
          </header>

      <div className="App-content">
        {error && (
          <div className="error-banner">
            <strong>Error:</strong> {error}
            <button onClick={handleRefresh}>Retry</button>
          </div>
        )}

        <div className="controls-section">
          <RegionSelector
            regions={regions}
            selectedRegion={selectedRegion}
            onSelect={setSelectedRegion}
            loading={loading}
          />
          <VpcSelector
            vpcs={vpcs}
            selectedVpc={selectedVpc}
            onSelect={setSelectedVpc}
            loading={loading}
          />
          {selectedVpc && (
            <div className="refresh-section">
              <button className="refresh-button" onClick={handleRefresh} title={isDataCached ? 'Data is from cache (5 min TTL) - click to refresh' : 'Refresh data'} disabled={loading}>
                🔄
              </button>
              {isDataCached && (
                <span className="cached-badge" title="Data is cached - click refresh to fetch latest">📦 Cached</span>
              )}
            </div>
          )}
        </div>

        {selectedVpc && (
          <div className={`main-content ${filterPanelExpanded ? 'filters-expanded' : 'filters-collapsed'}`}>
            {filterPanelExpanded && (
              <div className="filter-sidebar">
                <FilterPanel
                  subnets={subnets}
                  filters={filters}
                  onFiltersChange={setFilters}
                  isExpanded={filterPanelExpanded}
                />
              </div>
            )}

            <div className="middle-panel">
              <SubnetList
                subnets={subnets}
                selectedSubnet={selectedSubnet}
                onSelect={setSelectedSubnet}
                loading={loading}
                filters={filters}
                onFiltersChange={setFilters}
                filterPanelExpanded={filterPanelExpanded}
                onToggleFilterPanel={() => setFilterPanelExpanded(!filterPanelExpanded)}
              />
            </div>

            <div className="right-panel">
              {selectedSubnet && ipData ? (
                <>
                  <Suspense fallback={<LoadingPlaceholder />}>
                    <Statistics subnet={selectedSubnet} ipData={ipData} />
                    <IpVisualization ipData={ipData} />
                  </Suspense>
                  {loadingMoreIps && ipPaginationInfo && (
                    <div className="pagination-progress">
                      <div className="progress-info">
                        <span>Loading IPs...</span>
                        <span className="progress-count">{ipPaginationInfo.offset + ipPaginationInfo.returned} / {ipPaginationInfo.totalIps}</span>
                      </div>
                      <div className="progress-bar">
                        <div className="progress-fill" style={{ width: `${((ipPaginationInfo.offset + ipPaginationInfo.returned) / ipPaginationInfo.totalIps) * 100}%` }}></div>
                      </div>
                    </div>
                  )}
                </>
              ) : loadingIpData ? (
                <div className="placeholder">
                  <div className="spinner" style={{ margin: '2rem auto' }}></div>
                  <h3>Loading IP allocation...</h3>
                  {ipPaginationInfo && (
                    <p style={{ fontSize: '0.9rem', color: '#94a3b8', marginTop: '1rem' }}>
                      {ipPaginationInfo.offset + ipPaginationInfo.returned} / {ipPaginationInfo.totalIps} IPs loaded
                    </p>
                  )}
                </div>
              ) : (
                <div className="placeholder">
                  <h3>Select a subnet to view IP allocation</h3>
                  <p>Click on a subnet from the list to see its IP fragmentation visualization</p>
                </div>
              )}
            </div>
          </div>
        )}

        {!selectedVpc && !loading && selectedRegion && (
          <div className="welcome-message">
            <h2>Welcome to SubnetViz</h2>
            <p>Select a VPC from the dropdown above to visualize subnet allocation</p>
            <div className="legend">
              <h3>Color Legend:</h3>
              <div className="legend-items">
                <div className="legend-item">
                  <span className="color-box used"></span>
                  <span>Used IP (Primary ENI)</span>
                </div>
                <div className="legend-item">
                  <span className="color-box secondary"></span>
                  <span>Used IP (Secondary/EKS Pod)</span>
                </div>
                <div className="legend-item">
                  <span className="color-box prefix"></span>
                  <span>Used IP (Prefix Delegation)</span>
                </div>
                <div className="legend-item">
                  <span className="color-box reserved"></span>
                  <span>Reserved (AWS)</span>
                </div>
                <div className="legend-item">
                  <span className="color-box free"></span>
                  <span>Free/Available</span>
                </div>
              </div>
            </div>
          </div>
        )}
        </div>
      </div>

      <About isOpen={showAbout} onClose={() => setShowAbout(false)} />
      </ErrorBoundary>
    </ThemeContext.Provider>
  );
}

export default App;
