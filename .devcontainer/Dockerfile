FROM 10.0.0.15:5000/codepod/devcontainer:v12

# Install Node.js and other tools using apk
RUN apk add --no-cache curl git vim bash

# Install Node.js
RUN apk add --no-cache nodejs npm

WORKDIR /workspace
