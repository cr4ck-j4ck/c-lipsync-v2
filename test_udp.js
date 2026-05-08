const dgram = require('dgram');

const s = dgram.createSocket({ type: 'udp4', reuseAddr: true });

s.on('message', (msg, rinfo) => {
  console.log('Received:', msg.toString(), 'from', rinfo.address);
});

s.bind(41234, () => {
  s.setBroadcast(true);
  console.log('Bound');
  
  setInterval(() => {
    s.send('hello', 41234, '255.255.255.255', (err) => {
      if (err) console.error('Send error:', err);
      else console.log('Sent broadcast');
    });
  }, 1000);
});
