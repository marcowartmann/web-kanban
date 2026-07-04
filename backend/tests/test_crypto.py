from app.crypto import decrypt, encrypt


def test_encrypt_roundtrip():
    c = encrypt("s3cret-pw")
    assert c != "s3cret-pw"
    assert decrypt(c) == "s3cret-pw"


def test_ciphertext_is_not_deterministic_but_decrypts():
    a, b = encrypt("x"), encrypt("x")
    assert a != b  # Fernet includes a random IV
    assert decrypt(a) == decrypt(b) == "x"
