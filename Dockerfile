FROM node:20-slim
WORKDIR /usr/src/app
COPY package.json package-lock.json ./
RUN npm ci --production && npm cache clean --force
COPY . .

# production forces to have app_id / private_key beforehand, but we want self-service
ENV NODE_ENV="apprunner"
ENV PATH="/usr/src/app/bin:${PATH}"
ENV RUNS_ON_ENV="prod"

# make sure an empty file is present at beginning
RUN rm -f .env && touch .env

CMD [ "bin/run" ]
