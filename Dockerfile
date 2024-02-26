FROM node:20-slim
WORKDIR /usr/src/app
COPY package.json package-lock.json ./
RUN npm ci --production && npm cache clean --force
COPY . .

ENV NODE_ENV="production"
ENV PATH="/usr/src/app/bin:${PATH}"
ENV RUNS_ON_ENV="prod"

# make sure an empty file is present at beginning
RUN rm -f .env && touch .env

CMD [ "node", "./app.js" ]
