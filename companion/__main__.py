import argparse
from .server import CompanionServer

def main():
    parser=argparse.ArgumentParser(description="Local Lookout Rover vision companion")
    parser.add_argument("--port",type=int,default=8765)
    args=parser.parse_args()
    server=CompanionServer(args.port)
    print(f"Lookout Rover: http://127.0.0.1:{server.server_port}")
    print("Manual mode is unchanged. Assisted mode starts OFF. Ctrl+C to stop.")
    try:server.serve_forever()
    except KeyboardInterrupt:pass
    finally:server.server_close()

if __name__=="__main__":main()
