FROM node:15-alpine AS builder

WORKDIR /usr/src/app

COPY package.json yarn.lock ./

RUN yarn --frozen-lockfile
COPY tsconfig.json .
COPY src src

RUN yarn build

RUN ls -al
RUN rm ./src/**/*.ts

RUN npm prune --production

FROM node:15-alpine

WORKDIR /usr/src/app

COPY --from=builder /usr/src/app ./

CMD [ "node", "./src/main.js" ]