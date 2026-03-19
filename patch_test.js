const channel = new BroadcastChannel('baidrop_instance');
channel.postMessage('check');
channel.onmessage = (e) => {
    if (e.data === 'check') {
        channel.postMessage('exists');
    } else if (e.data === 'exists') {
        document.body.innerHTML = '<h2 style="text-align:center; padding: 50px;">Bái Drop is already open in another tab.</h2>';
    }
};
