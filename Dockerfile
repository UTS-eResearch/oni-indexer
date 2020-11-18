FROM node:10

VOLUME [ "/etc/share/dump", "/etc/share/config" ]

WORKDIR /usr/src/app
COPY . .
RUN npm install
EXPOSE 8090

ENTRYPOINT [ "/usr/src/app/oni-indexer.js", "-c", "/etc/share/config/indexer.json" ]
