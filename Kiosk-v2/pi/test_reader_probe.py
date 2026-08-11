import unittest

from reader_probe import card_uid_from_line, fingerprint


class ReaderProbeTests(unittest.TestCase):
    def test_accepts_only_plausible_hex_uid_lines(self):
        self.assertEqual(card_uid_from_line("04aabbcc\n"), "04AABBCC")
        self.assertIsNone(card_uid_from_line("Found chip PN532"))
        self.assertIsNone(card_uid_from_line("123"))
        self.assertIsNone(card_uid_from_line("04-AA-BB-CC"))

    def test_fingerprint_is_deterministic_and_does_not_contain_uid(self):
        value = fingerprint(b"a" * 32, "04AABBCC")
        self.assertEqual(value, fingerprint(b"a" * 32, "04AABBCC"))
        self.assertEqual(len(value), 12)
        self.assertNotIn("04AABBCC", value)


if __name__ == "__main__":
    unittest.main()
