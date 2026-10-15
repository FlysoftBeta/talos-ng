const text = new TextEncoder().encode('Talos');
Promise.resolve(text).then(function (bytes) { return bytes.length; });
