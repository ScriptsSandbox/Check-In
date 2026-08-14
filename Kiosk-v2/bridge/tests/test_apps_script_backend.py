from apps_script_backend import AppsScriptCheckInBackend


def test_result_preserves_profile_context():
    result = AppsScriptCheckInBackend._result({
        "outcome": "success",
        "displayName": "Test Maker",
        "visitCount": 3,
        "personId": "person_1",
        "profile": {
            "role": "Undergraduate Student (UG)",
            "affiliation": "Marine Biology",
            "anticipatedGraduation": "2028-06",
        },
    }, 42)
    assert result.person_id == "person_1"
    assert result.profile["role"] == "Undergraduate Student (UG)"
    assert result.profile["affiliation"] == "Marine Biology"
    assert result.profile["anticipatedGraduation"] == "2028-06"
