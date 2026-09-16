"""First on PYTHONPATH inside the cloud container, ahead of the sealed
worker directory, so every Python process the release starts gets the
container-safe verifier before it runs the sealed startup check.

Mirrors the sealed `worker/sitecustomize.py` exactly, with one call added.
"""
import os
if os.environ.get("PONGLENS_MATCH_RELEASE"):
    try:
        import match_release
        from stable_release import stabilize
        stabilize(match_release)
        match_release.verify_unchanged(os.environ["PONGLENS_MATCH_RELEASE"])
    except BaseException as error:
        os.write(2, ("Release verification failed: " + str(error) + "\n").encode())
        os._exit(78)
