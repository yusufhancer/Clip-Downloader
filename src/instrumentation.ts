export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initializeJobs } = await import("./lib/server/jobs");
    initializeJobs();
  }
}
