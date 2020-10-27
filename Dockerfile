FROM node:10

VOLUME [ "/etc/share/dump", "/usr/src/app" ]

WORKDIR /usr/src/app
EXPOSE 8090

ENTRYPOINT [ "npm", "run", "buildAndStart" ]
