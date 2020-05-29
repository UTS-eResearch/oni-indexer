FROM node:10

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 8090

ENTRYPOINT [ "/usr/src/app/oni-indexer.js", "-c", "/etc/share/config/indexer.json" ]
