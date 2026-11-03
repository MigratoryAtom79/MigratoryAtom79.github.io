from http.server import HTTPServer, SimpleHTTPRequestHandler

class HTTPRequestHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        # Strip out browser cache validation headers so Python never returns 304
        if "If-Modified-Since" in self.headers:
            del self.headers["If-Modified-Since"]
        if "If-None-Match" in self.headers:
            del self.headers["If-None-Match"]
        super().do_GET()

    def end_headers(self):
        # Send headers that force the browser to never cache the response
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        super().end_headers()

if __name__ == "__main__":
    server_address = ('', 8000)
    httpd = HTTPServer(server_address, HTTPRequestHandler)
    print("Serving HTTP on port 8000 (forced 200 OK mode)...")
    httpd.serve_forever()