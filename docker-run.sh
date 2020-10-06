#!/bin/bash

PORT=8090
DCK_PRE=en
VOL_BASE="/Users/mike/working/expert-nation"
VOL_OCFL="$VOL_BASE/ocfl/"
VOL_CONFIG="$VOL_BASE/config/"
NETWORK=en-main

DOCKER_CMD="docker run --rm -p 127.0.0.1:${PORT}:${PORT} -v ${VOL_CONFIG}:/etc/share/config -v ${VOL_OCFL}:/etc/share/ocfl --name ${DCK_PRE}-oni-indexer --network ${NETWORK} -d --entrypoint /usr/src/app/oni-indexer.js oni-indexer"

if [ "$1" == "clean" ];then
  DOCKER_CMD+=" -c /etc/share/config/indexer.json -p true"
else
  DOCKER_CMD+=" -c /etc/share/config/indexer.json -p false"
fi

echo ${DOCKER_CMD}

${DOCKER_CMD}
