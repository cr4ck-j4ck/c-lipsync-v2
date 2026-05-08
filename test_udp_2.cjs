const dgram = require('dgram');
const os = require('os');

const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });
const port = 41234;

s.on('message', (msg, rinfo) => {
  console.log('Received:', msg.toString(), 'from', rinfo.address);
});

s.bind(port, () => {
  s.setBroadcast(true);
  console.log('Bound');
  
  const targets = new Set(['255.255.255.255']);
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of (interfaces[name] || [])) {
      if (net.family === 'IPv4' && !net.internal && net.netmask) {
        const ipParts = net.address.split('.');
        const maskParts = net.netmask.split('.');
        const bc = ipParts
          .map((p, i) => ((~parseInt(maskParts[i] ?? '255') & 255) | parseInt(p)))
          .join('.');
        targets.add(bc);
      }
    }
  }

  const send = () => {
    for (const addr of targets) {
      s.send('hello', port, addr, (err) => {
        if (err) console.error(`Send error to ${addr}:`, err);
        else console.log(`Sent broadcast to ${addr}`);
      });
    }
  };
  
  send();
  setInterval(send, 1000);
});
