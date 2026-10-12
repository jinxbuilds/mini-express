FROM node:24-alpine

WORKDIR /app
ENV NODE_ENV=production PORT=3000

# No dependencies to install — the framework is pure Node.js.
COPY package.json index.js ./
COPY lib ./lib
COPY examples ./examples

USER node
EXPOSE 3000
CMD ["node", "examples/notes-app/server.js"]
