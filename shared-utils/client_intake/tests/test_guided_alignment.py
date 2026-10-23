"""The guided client experience, checked against the real shared bank.

Run: python3 -I shared-utils/client_intake/tests/test_guided_alignment.py
(or `python3 -I -m unittest discover -s shared-utils/client_intake/tests`)

These are the contract points the client-facing repair has to keep, so they fail loudly if
a later edit puts a technical detail, a hardcoded count, or a skipped "I don't know" back.
"""
import json
import re
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
INTAKE = HERE.parent
REPO = INTAKE.parent.parent
sys.path.insert(0, str(INTAKE))
sys.path.insert(0, str(REPO / "shared-utils" / "signature_launch" / "experience"))

import engine  # noqa: E402

BANK = json.loads((INTAKE / "question-bank.json").read_text(encoding="utf-8"))

TOPICS = ("timing", "channels", "conversation_ai", "access_delivery",
          "payment_plans", "sender_name", "reply_email", "texting_readiness")
SEASONAL = ("promo_dates", "promo_offer", "promo_limits", "promo_audience", "promo_followup")
# Words that must never reach the client: schema and id vocabulary, not plain English.
TECHNICAL = re.compile(r"\b(schema|tenant_id|location_id|route_graph|sha256|hash|a2p|10dlc|provider id|"
                       r"json|api|webhook|endpoint)\b", re.I)


def q(qid):
    return next(x for x in BANK["questions"] if x["id"] == qid)


class BankShape(unittest.TestCase):
    def test_the_eight_launch_topics_exist_and_are_conditional(self):
        for topic in TOPICS:
            question = q(topic)
            self.assertNotEqual(question["condition"], "always", topic)
            self.assertIn("legacy", question["condition"], topic)  # a legacy launch is never asked

    def test_the_seasonal_decisions_exist_and_are_black_friday_only(self):
        for topic in SEASONAL:
            self.assertEqual(q(topic)["condition"], "mode == bf", topic)

    def test_question_objects_keep_nested_help_default_and_option_explanations(self):
        for question in BANK["questions"]:
            self.assertIn("help", question, question["id"])
            self.assertIn("examples", question["help"], question["id"])
            if question["never_default"]:
                self.assertIsNone(question["default"], question["id"])
            elif question["default"] is not None:  # a defaultable question keeps its value and reason
                self.assertIn("value", question["default"], question["id"])
                self.assertIn("reason", question["default"], question["id"])

    def test_client_facing_text_names_no_technical_detail(self):
        for question in BANK["questions"]:
            for field in ("text", "why"):
                self.assertIsNone(TECHNICAL.search(question[field] or ""),
                                  f"{question['id']}.{field}: {question[field]}")

    def test_no_question_demands_a_table(self):
        for question in BANK["questions"]:
            self.assertNotIn(" | ", question["text"], question["id"])


class Opening(unittest.TestCase):
    def test_opening_question_is_the_contract_wording_with_abc(self):
        question = q("interview_mode")
        self.assertEqual(question["text"], "What is the best way for me to help you with your launch?")
        self.assertEqual([c[0] for c in question["choices"]], ["A", "B", "C"])

    def test_each_letter_stores_the_preference_the_skill_reads(self):
        for raw, want in (("A", "choose_for_me"), ("B", "help"), ("C", "know"),
                          ("A. Recommend a plan for me", "choose_for_me"),
                          ("B. Guide me through each decision", "help"),
                          ("C. I already have a plan", "know")):
            doc = engine.new_doc("launch")
            engine.record(doc, "interview_mode", raw)
            self.assertEqual(engine.val(doc, "interview_mode"), want, raw)


class HelpIsNotAnAnswer(unittest.TestCase):
    def test_i_dont_know_opens_coaching_and_is_not_recorded_as_an_answer(self):
        doc = engine.new_doc("launch")
        out = engine.record(doc, "timing", "I don't know")
        self.assertEqual(out["action"], "help")
        self.assertEqual([c["id"] for c in out["coaching"]], ["example", "explain", "recommend"])
        self.assertEqual(doc["answers"]["timing"]["status"], "unknown")

    def test_a_required_question_is_never_skipped_after_help(self):
        doc = engine.new_doc("launch")
        engine.record(doc, "timing", "not sure")
        engine.record(doc, "timing", "not sure")
        self.assertIn("timing", [x["id"] for x in engine.check(doc)["blocking"]])

    def test_a_second_help_on_a_defaultable_question_uses_a_flagged_default(self):
        doc = engine.new_doc("launch")
        engine.record(doc, "channels", "I don't know")
        out = engine.record(doc, "channels", "I don't know")
        self.assertEqual(out["action"], "default_applied")
        self.assertIn("channels", [t["id"] for t in doc["to_confirm"]])


class LaunchAnswersAreTyped(unittest.TestCase):
    def test_text_is_never_read_as_a_yes(self):
        doc = engine.new_doc("launch")
        engine.record(doc, "texting_readiness", "No, not yet")
        self.assertIs(engine.launch_answers(doc)["launch.a2p_ready"]["value"], False)

    def test_the_eight_topics_reach_the_ledger_with_provenance(self):
        doc = engine.new_doc("launch")
        engine.record(doc, "timing", "Doors open 14 Nov 2026 9:00 a.m. New York, launch at noon")
        engine.record(doc, "channels", "Email and text")
        engine.record(doc, "sender_name", "Elevation Coaching")
        engine.record(doc, "reply_email", "hello@elevationcoaching.com")
        ledger = engine.launch_answers(doc)
        self.assertEqual(ledger["launch.channels"]["value"], ["email", "text"])
        self.assertEqual(ledger["launch.sender_name"]["value"], "Elevation Coaching")
        self.assertTrue(ledger["launch.doors_open_at"]["value"].startswith("2026-11-14T09"))
        self.assertEqual(ledger["launch.reply_to_email"]["provenance"]["question_id"], "reply_email")

    def test_legacy_mode_carries_no_launch_answers(self):
        self.assertEqual(engine.launch_answers(engine.new_doc("legacy")), {})


class OffersOneAtATime(unittest.TestCase):
    def test_a_second_offer_is_added_and_a_repeat_is_a_correction(self):
        doc = engine.new_doc("launch")
        engine.record(doc, "packages", "Premium, 12 lessons, $497")
        engine.record(doc, "packages", "Starter, 6 lessons, $297")
        self.assertEqual(len(engine.view(doc)["packages"]), 2)
        engine.record(doc, "packages", "Starter, 6 lessons and 2 calls, $247")
        self.assertEqual(len(engine.view(doc)["packages"]), 2)
        self.assertTrue(engine.offer_summary(doc).startswith("Here is what I understood:"))

    def test_one_offer_is_a_complete_answer(self):
        doc = engine.new_doc("launch")
        self.assertTrue(engine.record(doc, "packages", "Premium, 12 lessons, $497")["ok"])


class ComputedNumbers(unittest.TestCase):
    def test_length_and_progress_are_computed_from_this_run(self):
        import guided_experience as gx
        launch = engine.new_doc("launch")
        bf = engine.new_doc("bf")
        legacy = engine.new_doc("legacy")
        self.assertLess(gx.estimate(legacy)[1], gx.estimate(launch)[1])
        self.assertLess(gx.estimate(launch)[1], gx.estimate(bf)[1])
        engine.record(launch, "business_name", "Elevation Coaching")
        self.assertLess(gx.estimate(launch)[0], gx.estimate(engine.new_doc("launch"))[0])
        self.assertRegex(gx.progress_line(launch), r"^\d+ of \d+ answered \(\d+%\)\.")

    def test_a_changed_estimate_is_explained(self):
        import guided_experience as gx
        line = gx.estimate_change(20, 18, "your package answer covered both packages")
        self.assertIn("from 20 to 18", line)
        self.assertIsNone(gx.estimate_change(20, 20, "nothing changed"))


class PlanReview(unittest.TestCase):
    def test_the_review_states_the_four_parts_and_promises_no_sales(self):
        import guided_experience as gx
        doc = engine.new_doc("launch")
        engine.record(doc, "business_name", "Elevation Coaching")
        text = gx.plan_review(doc, costs="Nothing to approve this plan.")
        for part in ("What you told me:", "What I understand, and what I recommend:",
                     "What will be built, and what it is meant to do:",
                     "Assumptions, limits and costs:"):
            self.assertIn(part, text)
        self.assertNotRegex(text.lower(), r"guarantee(d)? (you|sales)|guaranteed sales|will make you")
        self.assertIn("not approving it for you", text)

    def test_the_introduction_states_the_promise_and_the_three_choices(self):
        import guided_experience as gx
        text = gx.opening(engine.new_doc("launch"))
        self.assertIn("one thing at a time", text)
        self.assertIn("A. Recommend a plan for me", text)
        self.assertIn("B. Guide me through each decision", text)
        self.assertIn("C. I already have a plan", text)
        self.assertIn("Expect about", text)


if __name__ == "__main__":
    unittest.main()
