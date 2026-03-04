# STAGE 1: Builder
# Use 1.92 to match your host and satisfy MSRV requirements
FROM rust:1.92-slim-bookworm as builder

# Install system dependencies
RUN apt-get update && apt-get install -y \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# Copy only the manifest files first to cache dependencies
COPY Cargo.toml ./
# Copy Cargo.lock only if it exists
COPY Cargo.lock* ./

# Create a dummy source file to compile dependencies independently of your code
RUN mkdir src && echo "fn main() {}" > src/main.rs && \
    cargo build --release && \
    rm -rf src

# Now copy the real source code
COPY src ./src

# Build the real binary
RUN touch src/main.rs && cargo build --release

# STAGE 2: Runtime
FROM debian:bookworm-slim

# Install OpenSSL 3 and CA certs
RUN apt-get update && apt-get install -y \
    libssl3 \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# IMPORTANT: Match the binary name from your Cargo.toml here as well
COPY --from=builder /usr/src/app/target/release/milestone_scout /app/bot_executable

CMD ["./bot_executable"]