FROM node:20-slim

USER node
WORKDIR /app

COPY --chown=node:node package.json package-lock.json ./
RUN npm install --no-fund --omit=dev && npm cache clean --force
COPY --chown=node:node . .

ENV NODE_ENV="production"
ENV RUNS_ON_ENV="prod"

CMD [ "node", "./src/index.js" ]
