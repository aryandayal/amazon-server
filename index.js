const net = require('net');
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: 'http://localhost:3000', // Specific to your React app for better security
    methods: ['GET', 'POST']
  }
});

// Log when a web client connects
io.on('connection', (socket) => {
  console.log('Web client connected:', socket.id);
  socket.on('disconnect', () => {
    console.log('Web client disconnected:', socket.id);
  });
});

httpServer.listen(4000, () => {
  console.log('HTTP/WebSocket server listening on port 4000');
});

const tcpServer = net.createServer((socket) => {
  console.log('GPS client connected');
  let buffer = '';

  socket.on('data', (data) => {
    buffer += data.toString();
    let startIndex = buffer.indexOf('$');
    while (startIndex !== -1) {
      const endIndex = buffer.indexOf('*', startIndex);
      if (endIndex === -1) break;

      const packet = buffer.substring(startIndex, endIndex + 1);
      buffer = buffer.substring(endIndex + 1);

      processPacket(packet, socket);

      startIndex = buffer.indexOf('$');
    }
  });

  socket.on('end', () => {
    console.log('GPS client disconnected');
  });

  socket.on('error', (err) => {
    console.error('Socket error:', err);
  });
});

tcpServer.listen(5025, '0.0.0.0', () => {
  console.log('TCP server listening on port 5025');
});

tcpServer.on('error', (err) => {
  console.error('Server error:', err);
});

function processPacket(packet, socket) {
  if (!packet.startsWith('$') || !packet.endsWith('*')) {
    console.log('Invalid packet:', packet);
    return;
  }

  const content = packet.slice(1, -1);
  const fields = content.split(',');

  if (fields.length < 10) { // Basic validation
    console.log('Incomplete packet:', packet);
    return;
  }

  const header = fields[0];

  let parsedData;
  if (header === 'PVT') {
    parsedData = parsePVT(fields);
  } else if (header === 'LGN') {
    parsedData = parseLGN(fields);
  } else {
    console.log('Unhandled packet type:', header);
    parsedData = { header, rawFields: fields };
  }

  // Output as JSON (keep for logging)
  console.log(JSON.stringify(parsedData, null, 2));

  // Broadcast to WebSocket clients if it's a PVT packet with location data
  if (parsedData.header === 'PVT' && typeof parsedData.latitude === 'number' && typeof parsedData.longitude === 'number') {
    console.log('Emitting gps_update to clients'); // Added log to confirm emission
    io.emit('gps_update', {
      lat: parsedData.latitude,
      lng: parsedData.longitude,
      speed: parsedData.speed,
      heading: parsedData.heading,
      altitude: parsedData.altitude,
      satellites: parsedData.satellites,
      date: parsedData.date,
      time: parsedData.time,
      vehicleNo: parsedData.vehicleNo,
      imei: parsedData.imei
      // Add more fields as needed
    });
  }

  // Optional: Send a simple ACK back (custom, as protocol may vary; adjust as needed)
  // const ack = `$ACK,${fields[fields.length - 2]}*`; // e.g., ACK with frame number if available
  // socket.write(ack);
}

function parsePVT(fields) {
  // Parse based on AIS-140 PVT format from official specifications
  const json = {
    header: 'PVT',
    vendorId: fields[1],
    firmwareVersion: fields[2],  // Will be '2.1.6' as per your device
    packetType: fields[3], // e.g., NR = Normal, EA = Emergency
    alertId: fields[4],
    packetStatus: fields[5], // L = Live, H = History
    imei: fields[6], // Device ID
    vehicleNo: fields[7],
    gpsFix: parseInt(fields[8], 10),
    date: fields[9], // DDMMYYYY
    time: fields[10], // hhmmss UTC
    latitude: parseFloat(fields[11]) * (fields[12] === 'S' ? -1 : 1),
    longitude: parseFloat(fields[13]) * (fields[14] === 'W' ? -1 : 1),
    speed: parseFloat(fields[15]),
    heading: parseFloat(fields[16]),
    satellites: parseInt(fields[17], 10),
    altitude: parseFloat(fields[18]),
    pdop: parseFloat(fields[19]),
    hdop: parseFloat(fields[20]),
    networkOperator: fields[21],
    ignition: parseInt(fields[22], 10),
    mainPowerStatus: parseInt(fields[23], 10),
    mainInputVoltage: parseFloat(fields[24]),
    internalBatteryVoltage: parseFloat(fields[25]),
    emergencyStatus: parseInt(fields[26], 10)
  };

  // Optional/additional fields (add more as per your device)
  let index = 27;
  if (fields.length > index) json.tamperAlert = fields[index++];
  if (fields.length > index) json.gsmSignalStrength = parseInt(fields[index++], 10);
  if (fields.length > index) json.mcc = fields[index++];
  if (fields.length > index) json.mnc = fields[index++];
  if (fields.length > index) json.lac = fields[index++];
  if (fields.length > index) json.cellId = fields[index++];
  if (fields.length > index) json.nmr = fields[index++];
  if (fields.length > index) json.digitalInputStatus = fields[index++];
  if (fields.length > index) json.digitalOutputStatus = fields[index++];
  if (fields.length > index) json.analogInput1 = parseFloat(fields[index++]);
  if (fields.length > index) json.analogInput2 = parseFloat(fields[index++]);
  if (fields.length > index) json.frameNumber = fields[index++];

  // Last field before * is typically checksum; not parsing it here
  json.checksum = fields[fields.length - 1];

  return json;
}

function parseLGN(fields) {
  // Parse Login packet
  return {
    header: 'LGN',
    vehicleNo: fields[1],
    imei: fields[2],
    firmwareVersion: fields[3],
    protocolVersion: fields[4],
    lastLatitude: parseFloat(fields[5]),
    lastLongitude: parseFloat(fields[6]),
    checksum: fields[7]
  };
}