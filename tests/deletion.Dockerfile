FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends python3 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY src ./src
COPY tests ./tests
COPY nas ./nas
ENV ARR_NATIVE_TESTS=1 PYTHONDONTWRITEBYTECODE=1
USER node
CMD ["sh", "-c", "node --conditions=react-server --test tests/core.test.cjs tests/deletion.test.cjs tests/series-deletion.test.cjs tests/native-series-deletion.test.cjs && python3 -B -m unittest discover -s nas"]
