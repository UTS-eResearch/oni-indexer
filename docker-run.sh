#!/bin/bash

PORT=8090
DCK_PRE=sf
VOL_BASE="/Volumes/simon_seafood_testing/arkisto"
VOL_OCFL="$VOL_BASE/fake_ocfl/"
VOL_CONFIG="$VOL_BASE/oni-express/config/"
NETWORK=${DCK_PRE}-main
CLEAN=$1
DETACHED=$2

DOCKER_CMD="docker run --rm -p 127.0.0.1:${PORT}:${PORT} -v ${VOL_CONFIG}:/etc/share/config -v ${VOL_OCFL}:/etc/share/ocfl --name ${DCK_PRE}-oni-indexer --network ${NETWORK}"

if [ "$DETACHED" == "detached" ];then
  DOCKER_CMD+=" -d --entrypoint /usr/src/app/oni-indexer.js oni-indexer"
else
  DOCKER_CMD+=" --entrypoint /usr/src/app/oni-indexer.js oni-indexer"
fi

if [ "$CLEAN" == "clean" ];then
  DOCKER_CMD+=" -c /etc/share/config/indexer.json -p true"
else
  DOCKER_CMD+=" -c /etc/share/config/indexer.json -p false"
fi

${DOCKER_CMD}
