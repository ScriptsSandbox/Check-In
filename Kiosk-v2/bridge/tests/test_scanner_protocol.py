import unittest

from scanner_protocol import DuplicateGuard, normalize_uid


class NormalizeUidTests(unittest.TestCase):
    def test_accepts_uid_and_normalizes_case(self) -> None:
        self.assertEqual(normalize_uid("04:a1:b2:c3\r\n"), "04A1B2C3")

    def test_ignores_firmware_status_output(self) -> None:
        self.assertIsNone(normalize_uid("Found chip PN532"))

    def test_rejects_too_short_or_non_hex_values(self) -> None:
        self.assertIsNone(normalize_uid("ABC123"))
        self.assertIsNone(normalize_uid("04A1B2CZ"))


class DuplicateGuardTests(unittest.TestCase):
    def test_suppresses_same_uid_inside_window(self) -> None:
        guard = DuplicateGuard(window_seconds=2)
        self.assertTrue(guard.accept("04A1B2C3", now=10))
        self.assertFalse(guard.accept("04A1B2C3", now=11))
        self.assertTrue(guard.accept("04A1B2C3", now=13))

    def test_accepts_different_uid_immediately(self) -> None:
        guard = DuplicateGuard(window_seconds=2)
        self.assertTrue(guard.accept("04A1B2C3", now=10))
        self.assertTrue(guard.accept("04FFFFFF", now=10.1))

    def test_default_window_outlasts_a_slow_backend_request(self) -> None:
        guard = DuplicateGuard()
        self.assertTrue(guard.accept("04A1B2C3", now=10))
        self.assertFalse(guard.accept("04A1B2C3", now=18))

    def test_forget_allows_immediate_retry_after_backend_failure(self) -> None:
        guard = DuplicateGuard(window_seconds=15)
        self.assertTrue(guard.accept("04A1B2C3", now=10))
        guard.forget("04A1B2C3")
        self.assertTrue(guard.accept("04A1B2C3", now=11))

    def test_clear_allows_an_intentional_repeat(self) -> None:
        guard = DuplicateGuard(window_seconds=15)
        self.assertTrue(guard.accept("04A1B2C3", now=10))
        guard.clear()
        self.assertTrue(guard.accept("04A1B2C3", now=11))


if __name__ == "__main__":
    unittest.main()
