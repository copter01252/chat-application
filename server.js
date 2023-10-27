const cluster = require("node:cluster");
const http = require("node:http");
const os = require("os");
const process = require("node:process");
const { setupMaster, setupWorker } = require("@socket.io/sticky");
const { createAdapter, setupPrimary } = require("@socket.io/cluster-adapter");
const { Server } = require("socket.io");
const express = require("express");
const Redis = require("ioredis");
const connections = [];

const subscriber = Redis.createClient({
  url: "redis://localhost:6379",
});

const publisher = subscriber.duplicate();

const WS_CHANNEL = "livechat";

if (cluster.isPrimary) {
  console.log(`Primary ${process.pid} is running`);

  const httpServer = http.createServer();
  httpServer.listen(3000);

  setupMaster(httpServer, {
    loadBalancingMethod: "least-connection",
  });

  setupPrimary();
  cluster.setupPrimary({
    serialization: "advanced",
  });

  for (let i = 0; i < os.cpus().length; i++) {
    cluster.fork();
  }

  cluster.on("exit", (worker, code, signal) => {
    console.log(`worker ${worker.process.pid} died`);
  });
} else {
  console.log(`Worker ${process.pid} started`);

  const app = express();
  const httpServer = http.createServer(app);
  const io = new Server(httpServer);
  const redisClient = new Redis();

  io.adapter(createAdapter());

  setupWorker(io);

  subscriber.on("message", (channel, message) => {
    try {
      console.log(`server received message in channel ${channel} : ${message}`);
      connections.forEach((s) => {
        console.log("radis::" + s.id);
        s.emit("message", JSON.parse(message));
      });
    } catch (error) {
      console.log("ERR::" + error);
    }
  });

  io.on("connection", async (socket) => {
    console.log("Client is Connect..." + process.pid);

    // Fetch all the messages from redis
    // const existingMessages = await redisClient.lrange("chat_messages", 0, -1);
    // const parsedMessages = existingMessages
    //   .reverse()
    //   .map((item) => JSON.parse(item));
    // socket.emit("historical_messages", parsedMessages);

    subscriber.subscribe(WS_CHANNEL);

    socket.on("message", (data) => {
      console.log(`Message arrived at ${process.pid}`);

      console.log(socket.id);
      //   socket.emit("message", data);
      // redisClient.lpush("chat_messages", JSON.stringify(data));
      // io.emit("message", data);
      publisher.publish(
        WS_CHANNEL,
        JSON.stringify({ ...data, pid: process.pid })
      );
    });

    connections.push(socket);

    // subscriber.subscribe(WS_CHANNEL);
    // socket.on("history", async (data) => {
    //   const existingMessages = await redisClient.lrange("chat_messages", 0, -1);
    //   const parsedMessages = existingMessages
    //     .reverse()
    //     .map((item) => JSON.parse(item));
    //   io.emit("historical_messages", parsedMessages);
    // });
  });

  app.use(express.static("public"));
}
