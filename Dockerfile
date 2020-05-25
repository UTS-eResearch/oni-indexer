FROM node:10

# Note - this needs more thought

WORKDIR /usr/src/app
COPY package*.json ./
RUN npm install
COPY . .
EXPOSE 8090
