(() => {
    const basePath = "/v-proxy/";

    self.__uv$config = {
        prefix: basePath + "service/",
        encodeUrl: Ultraviolet.codec.xor.encode,
        decodeUrl: (str) => {
            if (!str) return str;
            let decoded = decodeURIComponent(str);
            let xorDecoded = decoded
                .split('')
                .map((char, ind) =>
                    ind % 2 ? String.fromCharCode(char.charCodeAt(0) ^ 2) : char
                )
                .join('');
            if (xorDecoded.startsWith('http://') || xorDecoded.startsWith('https://')) {
                return xorDecoded;
            }
            let [input, ...search] = str.split('?');
            return (
                decodeURIComponent(input)
                    .split('')
                    .map((char, ind) =>
                        ind % 2 ? String.fromCharCode(char.charCodeAt(0) ^ 2) : char
                    )
                    .join('') + (search.length ? '?' + search.join('?') : '')
            );
        },
        handler: basePath + "uv.handler.js",
        client: basePath + "uv.client.js",
        bundle: basePath + "uv.bundle.js",
        config: basePath + "uv.config.js",
        sw: basePath + "uv.sw.js",
        stockSW: basePath + "sw.js",
    };
})();
