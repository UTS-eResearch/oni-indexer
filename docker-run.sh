#!/bin/bash

PORT=8090
DCK_PRE=en
VOL_OCFL="/Users/moises/source/github/uts-eresearch/heurist2ro-crate/en_ocfl/"
VOL_CONFIG="/Users/moises/source/github/uts-eresearch/oni-express/config/"
NETWORK=main

DOCKER_CMD="docker run --rm -p 127.0.0.1:${PORT}:${PORT} -v ${VOL_CONFIG}:/etc/share/config -v ${VOL_OCFL}:/etc/share/ocfl --name ${DCK_PRE}-oni-indexer --network ${NETWORK} -d --entrypoint /usr/src/app/oni-indexer.js oni-indexer"

if [ "$1" == "clean" ];then
  DOCKER_CMD+=" -c /etc/share/config/indexer.json -p true"
else
  DOCKER_CMD+=" -c /etc/share/config/indexer.json -p false"
fi

${DOCKER_CMD}