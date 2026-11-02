import { createFollower } from "../../apps/web/src/lib/listen-follow";

const long = document.getElementById("long")!;
long.textContent =
  "A long source passage stays visible while a narrator moves through its later lines. ".repeat(
    100,
  );
const status = document.getElementById("status")!;
const follower = createFollower(() => {
  status.textContent = follower.following ? "Following" : "Browsing";
});
let progress = 0;
document.getElementById("start")!.onclick = () => {
  progress = 0;
  follower.start();
  long.setAttribute("data-speaking", "");
  follower.reveal(long, progress);
  status.textContent = "Following";
};
document.getElementById("advance")!.onclick = () => {
  progress = Math.min(1, progress + 0.25);
  follower.reveal(long, progress);
};
document.getElementById("follow")!.onclick = () => follower.follow(long);
Object.assign(window, {
  viewportEvidence: () => {
    const rect = long.getBoundingClientRect();
    return {
      scrollY,
      progress,
      point: rect.top + rect.height * progress,
      toolbarBottom: document
        .querySelector(".reader-toolbar")!
        .getBoundingClientRect().bottom,
      pillTop: document.querySelector(".listen-wrap")!.getBoundingClientRect()
        .top,
      following: follower.following,
      height: innerHeight,
    };
  },
});
