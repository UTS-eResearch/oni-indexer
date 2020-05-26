FROM node:10

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 8090

ENTRYPOINT [ "/usr/src/app/commit-to-solr.js", "-c", "/etc/share/config/indexer/config.json" ]
