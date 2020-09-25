#!/bin/bash

PORT=8090
VOLUMES_FROM=en-oni-express
DCK_PRE=en
NETWORK=main

docker run --rm -p 127.0.0.1:${PORT}:${PORT} \
--volumes-from ${VOLUMES_FROM} \
--name ${DCK_PRE}-oni-indexer \
--network ${NETWORK} \
-d \
oni-indexer