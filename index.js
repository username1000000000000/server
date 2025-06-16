const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const { Resend } = require("resend");
require('dotenv').config();
const { Prompts } = require('./Prompts');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: 'https://linguavana.com/camserverpage',
    methods: ['GET', 'POST']
  }
});
app.use(cors());
app.use(express.json());
const resend = new Resend(process.env.RESEND_API_KEY);

// CONTACT FORM
app.post("/api/contact", async (req, res) => {
  const { name, email, message, rating } = req.body;

  try {
    await resend.emails.send({
      from: "onboarding@resend.dev",
      to: "yourteam@example.com",
      subject: `New Contact Message from ${name}`,
      html: `
        <strong>Name:</strong> ${name}<br/>
        <strong>Email:</strong> ${email}<br/>
        <strong>Message:</strong><br/>${message.replace(/\n/g, "<br/>")}<br/>
        <strong>Rating:</strong> ${rating}/5
      `
    });

    res.status(200).json({ message: "Message sent successfully" });
  } catch (err) {
    console.error("Resend Contact Error:", err);
    res.status(500).json({ error: "Failed to send contact message" });
  }
});

// REPORT FORM
app.post("/api/report", async (req, res) => {
  const { name, email, issueType, details } = req.body;

  try {
    await resend.emails.send({
      from: "onboarding@resend.dev",
      to: "admin@example.com",
      subject: `Issue Reported: ${issueType}`,
      html: `
        <strong>Name:</strong> ${name}<br/>
        <strong>Email:</strong> ${email}<br/>
        <strong>Issue Type:</strong> ${issueType}<br/>
        <strong>Details:</strong><br/>${details.replace(/\n/g, "<br/>")}
      `
    });

    res.status(200).json({ message: "Issue reported successfully" });
  } catch (err) {
    console.error("Resend Report Error:", err);
    res.status(500).json({ error: "Failed to send issue report" });
  }
});
const lobby = [];
const callPairs = new Map();
const socketToUidMap = new Map();
const uidToSocketMap = new Map();



// make sure this file exports: `exports.Prompts = [ ... ];`

function tryPairUsers() {
  while (lobby.length >= 2) {
    const user1 = lobby.shift();
    const user2 = lobby.shift();

    callPairs.set(user1, user2);
    callPairs.set(user2, user1);

    const [initiator, responder] = [user1, user2].sort(); // alphabetically

    // 🔹 Choose a random prompt once
    const randomPrompt = Prompts[Math.floor(Math.random() * Prompts.length)];

    // 🔹 Send to both clients
    io.to(initiator).emit('found-partner', {
      partnerId: responder,
      isInitiator: true,
      partnerUid: socketToUidMap.get(responder),
      prompt: randomPrompt,
    });

    io.to(responder).emit('found-partner', {
      partnerId: initiator,
      isInitiator: false,
      partnerUid: socketToUidMap.get(initiator),
      prompt: randomPrompt,
    });

  
  }
}


io.on('connection', (socket) => {
  socket.on('register-user', ({ uid }) => {
    uidToSocketMap.set(uid, socket.id);
    socketToUidMap.set(socket.id, uid);
 

    if (!lobby.includes(socket.id)) {
      lobby.push(socket.id);
      tryPairUsers();
    }
  });

  socket.on('send-offer', ({ target, offer }) => {
   
    io.to(target).emit('receive-offer', { from: socket.id, offer });
  });

  socket.on('send-answer', ({ target, answer }) => {
   
    io.to(target).emit('receive-answer', { from: socket.id, answer });
  });

  socket.on('ice-candidate', ({ target, candidate }) => {
    
    io.to(target).emit('ice-candidate', { from: socket.id, candidate });
  });

  socket.on('in-call-message', ({ target, message }) => {
    io.to(target).emit('in-call-message', { message });
  });

  function endCallFor(socketId) {
    const partnerId = callPairs.get(socketId); // ⬅️ FIXED
  
    if (partnerId) {
      // Notify partner their call ended
      io.to(partnerId).emit('call-ended');
  
      // Clean both entries
      callPairs.delete(socketId);
      callPairs.delete(partnerId);
  
      // Remove socketId from lobby (already handled in disconnect)
      const partnerIndex = lobby.indexOf(partnerId);
      if (partnerIndex !== -1) lobby.splice(partnerIndex, 1);
  
      // Put partner back in lobby
      if (!lobby.includes(partnerId)) {
        lobby.push(partnerId);
       
      }
  
      tryPairUsers(); // ⬅️ Optional: trigger re-pairing
    } else {
      // No active call, just cleanup
      callPairs.delete(socketId);
    }
  }
  

  const returnToLobby = (id) => {
    if (!lobby.includes(id)) lobby.push(id);
  };

  socket.on('end-call', () => {
    const partnerId = callPairs.get(socket.id);
   
  
    if (partnerId) {
      io.to(partnerId).emit('call-ended');
  
      // Clean up both users
      callPairs.delete(socket.id);
      callPairs.delete(partnerId);
  
      // ⬇️ Requeue the partner who didn't end the call
      if (!lobby.includes(partnerId)) {
        lobby.push(partnerId);
        tryPairUsers(); // Try pairing immediately if possible
      }
    } else {
      callPairs.delete(socket.id);
    }
  });
  

  socket.on('skip-call', () => {
   
    const partnerId = callPairs.get(socket.id);

    endCallFor(socket.id);
    if (partnerId) returnToLobby(partnerId);
    returnToLobby(socket.id);
    tryPairUsers();
  });

  socket.on('disconnect', () => {
    
    endCallFor(socket.id);
    const index = lobby.indexOf(socket.id);
    if (index !== -1) lobby.splice(index, 1);
    socketToUidMap.delete(socket.id);
  });
});

app.get('/', (req, res) => {
  res.send('WebSocket server is running!');
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
