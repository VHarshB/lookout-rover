"""Configure non-secret AWS settings locally. Never asks for access/secret keys."""
import json
import os
from pathlib import Path

def main():
    print("Use AWS CLI authentication first: aws configure sso; aws sso login --profile lookout")
    print("No AWS secret keys are entered here or stored in this repository.")
    path=Path(__file__).with_name("local-config.json")
    old=json.loads(path.read_text()) if path.exists() else {}
    settings={}
    for key,label,default in [
        ("profile","AWS profile name",os.environ.get("AWS_PROFILE",old.get("profile","lookout"))),
        ("region","Bedrock AWS region",os.environ.get("AWS_REGION",old.get("region","us-east-1"))),
        ("model","Bedrock model/inference-profile ID enabled for your account",old.get("model",""))]:
        answer=input(label+" ["+default+"]: ").strip() or default
        if not answer:raise SystemExit("Model ID is required. See docs/ASSISTED_SETUP.md")
        settings[key]=answer
    path.write_text(json.dumps(settings,indent=2))
    print("Saved ignored non-secret local settings. Restart python -m companion.")

if __name__=="__main__":main()
