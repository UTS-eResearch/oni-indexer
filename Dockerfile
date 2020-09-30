FROM node:10

VOLUME ["/etc/share/dump"]

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 8090

ENTRYPOINT [ "/usr/src/app/oni-indexer.js", "-c", "/etc/share/config/indexer.json" ]
