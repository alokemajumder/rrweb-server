# Use an official Node.js runtime as a parent image.
FROM node:16-alpine

# Set working directory.
WORKDIR /app

# Copy package files and install dependencies.
COPY package*.json ./
RUN npm install --production

# Copy the rest of the application code.
COPY . .

# Expose the port on which the app runs.
EXPOSE 3000

# Start the application.
CMD ["npm", "start"]
