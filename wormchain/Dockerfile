FROM docker.io/golang:1.19.0@sha256:4c00329e17be6fedd8bd4412df454a205348da00f9e0e5d763380a29eb096b75

#used for a readiness probe
RUN apt-get update
RUN apt install -y netcat
RUN apt install -y jq

WORKDIR /app

COPY ./wormchain/go.mod .
COPY ./wormchain/go.sum .
COPY ./sdk /sdk
RUN go mod download

# copy over c bindings (libwasmvm.x86_64.so, etc)
RUN cp -r /go/pkg/mod/github.com/!cosm!wasm/wasmvm@v1.1.1/internal/api/* /usr/lib

COPY ./wormchain .

EXPOSE 26657
EXPOSE 26656
EXPOSE 6060
EXPOSE 9090
EXPOSE 1317
EXPOSE 4500

RUN unset GOPATH

# create the dir for the default "home" config
RUN mkdir -p /root/.wormchain

ARG num_guardians
ENV NUM_GUARDIANS=$num_guardians

RUN /bin/bash /app/devnet/create-genesis.sh

RUN make client
RUN chmod +x /app/build/wormchaind


ENTRYPOINT ["/bin/bash","-c","/app/build/wormchaind start"]
