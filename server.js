const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' }, transports: ['websocket', 'polling'] });
const rooms = new Map();
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true, service: 'football-online' }));
function code() { return Math.random().toString(36).slice(2, 8).toUpperCase(); }
function leaveRoom(socket) {
  const roomCode = socket.data.room;
  if (!roomCode) return;
  const room = rooms.get(roomCode);
  socket.leave(roomCode);
  socket.data.room = null;
  if (room) {
    room.players.delete(socket.id);
    if (room.players.size === 0) rooms.delete(roomCode);
    else io.to(roomCode).emit('peer-left');
  }
}
io.on('connection', socket => {
  socket.on('create-room', data => {
    leaveRoom(socket);
    let roomCode; do { roomCode = code(); } while (rooms.has(roomCode));
    rooms.set(roomCode, { host: socket.id, players: new Set([socket.id]), names: new Map([[socket.id, String(data?.name || 'Jugador').slice(0,18)]]) });
    socket.data.room = roomCode; socket.join(roomCode);
    socket.emit('room-created', { code: roomCode });
  });
  socket.on('join-room', data => {
    const roomCode = String(data?.code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0,6);
    const room = rooms.get(roomCode);
    if (!room) return socket.emit('room-error', { message: 'No existe esa sala. Revisa el código.' });
    if (room.players.size >= 2) return socket.emit('room-error', { message: 'La sala ya está llena.' });
    leaveRoom(socket);
    room.players.add(socket.id); room.names.set(socket.id, String(data?.name || 'Jugador').slice(0,18));
    socket.data.room = roomCode; socket.join(roomCode);
    socket.emit('room-joined', { code: roomCode });
    io.to(room.host).emit('peer-joined');
  });
  socket.on('start-match', data => {
    const room = rooms.get(String(data?.room || socket.data.room));
    if (!room || room.host !== socket.id || room.players.size !== 2) return;
    socket.to(socket.data.room).emit('start-match', { room: socket.data.room, role: data.role, hostName: data.name });
  });
  socket.on('input', data => {
    if (!socket.data.room || data?.room !== socket.data.room) return;
    const x = Math.max(-1, Math.min(1, Number(data.x) || 0));
    const y = Math.max(-1, Math.min(1, Number(data.y) || 0));
    socket.to(socket.data.room).emit('input', { x, y });
  });
  socket.on('action', data => {
    if (!socket.data.room || data?.room !== socket.data.room || !['pass','shoot','through'].includes(data.type)) return;
    socket.to(socket.data.room).emit('action', { type: data.type, k: Math.max(0, Math.min(1, Number(data.k) || 0)), curl: !!data.curl });
  });
  socket.on('snapshot', data => {
    if (!socket.data.room || data?.room !== socket.data.room) return;
    const room = rooms.get(socket.data.room);
    if (!room || room.host !== socket.id) return;
    // Reenvía solo el estado del partido a su compañero.
    socket.to(socket.data.room).volatile.emit('snapshot', data);
  });
  socket.on('disconnect', () => leaveRoom(socket));
});
const PORT = process.env.PORT || 3000;
server.listen(PORT, '0.0.0.0', () => console.log(`Football Online listo en puerto ${PORT}`));
