#!/bin/bash
docker run --rm -p 5000:5000 --user 1000 --cap-drop=ALL --cap-add=NET_BIND_SERVICE \
   -v ~/.aws:/app/.aws -e AWS_PROFILE=$1 \
   vpc-ip-viewer
