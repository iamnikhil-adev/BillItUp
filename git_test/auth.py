def login():
    pass

def login_with_google(token, client_id):
    """
    Verifies a Google ID token and logs the user in.
    Requires google-auth library: pip install google-auth
    """
    try:
        from google.oauth2 import id_token
        from google.auth.transport import requests
        
        # Verify the token
        idinfo = id_token.verify_oauth2_token(token, requests.Request(), client_id)

        # If valid, extract user info
        userid = idinfo['sub']
        email = idinfo.get('email')
        
        return {"status": "success", "userid": userid, "email": email}
    except ImportError:
        return {"status": "error", "message": "google-auth library is not installed."}
    except ValueError:
        # Invalid token
        return {"status": "error", "message": "Invalid Google token."}
