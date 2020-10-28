FROM node:10

VOLUME [ "/etc/share/dump", "/etc/share/config" ]

WORKDIR /usr/src/app
COPY . .
RUN npm install
EXPOSE 8090

ENTRYPOINT [ "npm", "start", "--config", "/etc/share/config/indexer.json"]
