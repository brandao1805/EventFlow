FROM node:22-bookworm-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node db ./db
COPY --chown=node:node test ./test
USER node
EXPOSE 3000
CMD ["npm","start"]
