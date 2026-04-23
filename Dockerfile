# Multistage Dockerfile to build a node application

FROM node:19.5.0-alpine
USER root
RUN apk add --no-cache git openssh openssl
# Enable OpenSSL 3.x legacy provider so old-format RSA private keys
# (BEGIN RSA PRIVATE KEY / PKCS#1) are accepted by libcrypto / OpenSSH.
RUN sed -i 's/^# \(legacy\s*=\s*legacy_sect\)/\1/' /etc/ssl/openssl.cnf || \
    printf '\n[provider_sect]\ndefault = default_sect\nlegacy = legacy_sect\n[default_sect]\nactivate = 1\n[legacy_sect]\nactivate = 1\n' >> /etc/ssl/openssl.cnf
WORKDIR /node-app
COPY package.json package.json
RUN npm i
COPY . .
COPY docker_image_version_${NEW_TAG}.txt /docker_image_version_${NEW_TAG}.txt
ENV CI=true
RUN npm run test
CMD [ "npm" , "run", "start:dev"]
