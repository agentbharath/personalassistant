import { expect, it } from "vitest";
import { cleanCardFollowUps } from "./card-followups";
it("stores complete executable text and one chip per purpose in display order", () => {
  const text = "Remember that I wear medium fleece jackets and prefer them to fit over another layer";
  const chips = cleanCardFollowUps([
    { label: "Remember my size", text, purpose: "act" },
    { label: "More jackets", text: "More fleece jackets", purpose: "widen" },
    { label: "Cheaper jackets", text: "Fleece jackets under $40", purpose: "narrow" },
    { label: "Save another size", text: "duplicate", purpose: "act" },
  ]);
  expect(chips).toHaveLength(3);
  expect(chips[0]).toMatchObject({ purpose: "narrow" });
  expect(chips[1]).toMatchObject({ purpose: "act", act: true, text });
});
it("keeps old stored string chips readable", () => {
  expect(cleanCardFollowUps(["Compare top 2", " "])).toEqual(["Compare top 2"]);
});
