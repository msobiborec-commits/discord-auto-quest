/**
 * Discord Quest Parallel Auto-Completer (Captcha-Safe Queue Engine + Auto-Enroll)
 * 
 * Features:
 *   - Auto-Discovery & Auto-Enroll: Automatically fetches and accepts all new quests
 *     (both in Discord's API and internal Flux stores).
 *   - MAX_CONCURRENT = 2: Runs at most 2 quests at a time for maximum safety.
 *   - Manual Captcha Claiming: Due to Discord's updated captcha protection, rewards
 *     are claimed manually by the user in the official UI.
 *   - Auto-Detection & Queue Progression: The script listens for the user's manual claim
 *     in Discord, and the moment captcha is solved and reward is claimed, it automatically
 *     starts the next 2 quests in the queue!
 *   - Real-time 1x video playback timing to prevent "Inauthentic Engagement" flags.
 * 
 * @license MIT
 */

(async function runDiscordQuestCompleter() {
    delete window.$;
    let wpRequire = webpackChunkdiscord_app.push([[Symbol()], {}, r => r]);
    webpackChunkdiscord_app.pop();

    function findModule(predicate) {
        for (const m of Object.values(wpRequire.c)) {
            if (!m?.exports) continue;
            try {
                if (predicate(m.exports)) return m.exports;
                for (const k of Object.keys(m.exports)) {
                    try {
                        if (predicate(m.exports[k])) return m.exports[k];
                    } catch (e) {}
                }
            } catch (e) {}
        }
        return null;
    }

    const ApplicationStreamingStore = findModule(x => typeof x?.getStreamerActiveStreamMetadata === "function");
    const RunningGameStore = findModule(x => typeof x?.getRunningGames === "function" && typeof x?.getGameForPID === "function");
    const QuestsStore = findModule(x => typeof x?.getQuest === "function" || typeof x?.quests !== "undefined");
    const ChannelStore = findModule(x => typeof x?.getAllThreadsForParent === "function");
    const GuildChannelStore = findModule(x => typeof x?.getSFWDefaultChannel === "function");
    const FluxDispatcher = findModule(x => typeof x?.dispatch === "function" && typeof x?.subscribe === "function");
    const api = findModule(x => typeof x?.get === "function" && typeof x?.post === "function");

    if (!RunningGameStore || !QuestsStore || !FluxDispatcher || !api) {
        console.error("%c[Safe Quest Completer] Failed to locate Discord internal modules.", "color: #ED4245; font-size: 14px; font-weight: bold;");
        return;
    }

    // Helper: Normalize quest objects between API (snake_case) and Discord Flux store (camelCase)
    function normalizeQuest(q) {
        if (!q || !q.config) return q;
        q.config.expiresAt = q.config.expiresAt || q.config.expires_at;
        q.config.taskConfig = q.config.taskConfig || q.config.taskConfigV2 || q.config.task_config || q.config.task_config_v2;
        q.config.taskConfigV2 = q.config.taskConfigV2 || q.config.task_config_v2 || q.config.taskConfig;
        if (q.config.messages) {
            q.config.messages.questName = q.config.messages.questName || q.config.messages.quest_name;
        }
        const us = q.userStatus || q.user_status;
        if (us) {
            us.enrolledAt = us.enrolledAt || us.enrolled_at;
            us.completedAt = us.completedAt || us.completed_at;
            us.claimedAt = us.claimedAt || us.claimed_at;
            q.userStatus = us;
            q.user_status = us;
        }
        return q;
    }

    // Step 1: Force fetch all available quests directly from Discord API
    console.log("%c[Safe Quest Completer] Fetching newest quests from Discord API...", "color: #00B0F4;");
    let fetchedQuests = [];
    try {
        const meRes = await api.get({ url: "/quests/@me" });
        fetchedQuests = meRes.body?.quests || [];
        if (fetchedQuests.length > 0) {
            try {
                FluxDispatcher.dispatch({
                    type: "QUESTS_FETCH_CURRENT_QUESTS_SUCCESS",
                    quests: fetchedQuests
                });
            } catch (e) {}
        }
    } catch (e) {
        console.warn("[Safe Quest Completer] Could not refresh /quests/@me directly, falling back to cached store.");
    }

    const supportedTasks = ["WATCH_VIDEO", "WATCH_VIDEO_ON_MOBILE", "PLAY_ON_DESKTOP", "STREAM_ON_DESKTOP", "PLAY_ACTIVITY"];
    const isApp = typeof DiscordNative !== "undefined";
    const now = Date.now();

    // Helper: Auto-enroll in quest with full store synchronization
    async function enrollInQuest(q) {
        normalizeQuest(q);
        const qName = q.config?.messages?.questName || q.config?.name || "Quest";
        try {
            console.log(`%c[Safe Quest Completer] 📝 Auto-accepting quest: '${qName}'...`, "color: #FEE75C; font-weight: bold;");
            const res = await api.post({ url: `/quests/${q.id}/enroll`, body: { location: 1 } });
            const statusObj = res.body?.enrolled_at ? res.body : (res.body?.user_status || res.body || {});
            
            // Normalize snake_case and camelCase
            if (!statusObj.enrolledAt && statusObj.enrolled_at) statusObj.enrolledAt = statusObj.enrolled_at;
            if (!statusObj.enrolled_at && statusObj.enrolledAt) statusObj.enrolled_at = statusObj.enrolledAt;
            if (!statusObj.enrolledAt && !statusObj.enrolled_at) {
                statusObj.enrolledAt = statusObj.enrolled_at = new Date().toISOString();
            }

            // Mutate in-memory quest object
            q.userStatus = statusObj;
            q.user_status = statusObj;

            // Mutate QuestsStore in Discord
            const liveQ = (QuestsStore.quests instanceof Map ? QuestsStore.quests.get(q.id) : QuestsStore.quests?.[q.id]) || QuestsStore.getQuest?.(q.id);
            if (liveQ) {
                liveQ.userStatus = statusObj;
                liveQ.user_status = statusObj;
            }

            // Dispatch to FluxDispatcher so Discord internal Quest Tracker recognizes enrollment and sends heartbeats
            try {
                FluxDispatcher.dispatch({
                    type: "QUESTS_ENROLL_SUCCESS",
                    questId: q.id,
                    userStatus: statusObj,
                    quest: liveQ || q
                });
            } catch (e) {}

            console.log(`%c[Safe Quest Completer] ✅ Quest '${qName}' accepted and activated!`, "color: #57F287; font-weight: bold;");
            await new Promise(r => setTimeout(r, 1000));
            return true;
        } catch (err) {
            console.error(`[Safe Quest Completer] Could not auto-enroll in '${qName}':`, err?.message || err);
            return false;
        }
    }

    // Step 2: Combine quests from QuestsStore and API fetch
    const questMap = new Map();
    const storeQuests = QuestsStore.quests instanceof Map
        ? Array.from(QuestsStore.quests.values())
        : (QuestsStore.quests ? Object.values(QuestsStore.quests) : []);

    for (const q of storeQuests) {
        if (q && q.id) questMap.set(q.id, normalizeQuest(q));
    }
    for (const q of fetchedQuests) {
        if (q && q.id) {
            if (!questMap.has(q.id)) {
                questMap.set(q.id, normalizeQuest(q));
            } else {
                const existing = questMap.get(q.id);
                normalizeQuest(existing);
                normalizeQuest(q);
                if (q.userStatus && !existing.userStatus) {
                    existing.userStatus = q.userStatus;
                    existing.user_status = q.user_status;
                }
            }
        }
    }

    // Step 3: Filter active, supported, uncompleted/unclaimed quests
    let allQuests = Array.from(questMap.values()).filter(x => {
        if (!x?.config) return false;
        const exp = new Date(x.config.expiresAt || x.config.expires_at).getTime();
        if (isNaN(exp) || exp <= now) return false;
        
        const uStatus = x.userStatus || x.user_status;
        const isClaimed = !!(uStatus?.claimedAt || uStatus?.claimed_at);
        if (isClaimed) return false;

        const taskCfg = x.config.taskConfig || x.config.taskConfigV2 || x.config.task_config || x.config.task_config_v2;
        if (!taskCfg?.tasks) return false;

        return supportedTasks.some(t => Object.keys(taskCfg.tasks).includes(t));
    });

    if (allQuests.length === 0) {
        showToast("🎉 All Quests Completed", "All available quests are already completed and claimed!");
        return;
    }

    // Auto-enroll in all available un-enrolled quests
    for (const q of allQuests) {
        const isEnrolled = !!(q.userStatus?.enrolledAt || q.userStatus?.enrolled_at);
        if (!isEnrolled) {
            await enrollInQuest(q);
        }
    }

    const MAX_CONCURRENT = 2; // Maximum 2 active quests at a time for safety
    const queue = [...allQuests];
    const totalCount = queue.length;

    console.log(`%c🛡️ [Safe Quest Completer] Loaded ${totalCount} quest(s). Max ${MAX_CONCURRENT} active at a time. Auto-enroll and manual captcha-safe claiming active.`, "color: #57F287; font-size: 14px; font-weight: bold;");

    // Multi-game RunningGameStore manager
    const originalGetRunningGames = RunningGameStore.getRunningGames;
    const originalGetGameForPID = RunningGameStore.getGameForPID;
    const activeFakeGames = new Map();

    function updateGamesDispatch() {
        const fakeList = Array.from(activeFakeGames.values());
        RunningGameStore.getRunningGames = () => fakeList;
        RunningGameStore.getGameForPID = (pid) => fakeList.find(x => x.pid === pid);
        FluxDispatcher.dispatch({
            type: "RUNNING_GAMES_CHANGE",
            removed: [],
            added: fakeList,
            games: fakeList
        });
    }

    // Non-blocking Discord styled toast notification
    function showToast(title, body) {
        try {
            const containerId = "__discord_quest_toasts";
            let container = document.getElementById(containerId);
            if (!container) {
                container = document.createElement("div");
                container.id = containerId;
                container.style.cssText = "position: fixed; top: 30px; right: 30px; z-index: 1000000; display: flex; flex-direction: column; gap: 10px; pointer-events: none;";
                document.body.appendChild(container);
            }
            const toast = document.createElement("div");
            toast.style.cssText = "background: #2b2d31; color: #f2f3f5; border: 1px solid #5865f2; border-left: 6px solid #57f287; border-radius: 8px; padding: 14px 18px; box-shadow: 0 8px 24px rgba(0,0,0,0.5); font-family: 'gg sans', 'Noto Sans', sans-serif; pointer-events: auto; max-width: 380px; transition: opacity 0.3s ease, transform 0.3s ease; opacity: 0; transform: translateY(-10px);";
            toast.innerHTML = `<div style="font-weight: bold; font-size: 14px; margin-bottom: 4px; color: #57f287;">${title}</div><div style="font-size: 13px; line-height: 1.4; color: #dbdee1;">${body}</div>`;
            container.appendChild(toast);
            requestAnimationFrame(() => {
                toast.style.opacity = "1";
                toast.style.transform = "translateY(0)";
            });
            setTimeout(() => {
                toast.style.opacity = "0";
                toast.style.transform = "translateY(-10px)";
                setTimeout(() => toast.remove(), 400);
            }, 8000);
        } catch (e) {
            console.log(`[Toast] ${title}: ${body}`);
        }
    }

    // Notification sound for user when quest hits 100%
    function playNotificationSound() {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = 587.33; // D5
            gain.gain.setValueAtTime(0.12, ctx.currentTime);
            osc.start();
            osc.stop(ctx.currentTime + 0.35);
        } catch (e) {}
    }

    // Waits for the user to solve captcha and click "Claim Reward" in Discord UI
    function waitForUserToClaimReward(quest) {
        normalizeQuest(quest);
        const questName = quest.config?.messages?.questName || quest.id;
        console.log(`%c🔔 [${questName}] 100% COMPLETE! Waiting for user to claim reward & solve captcha in Discord...`, "color: #57F287; font-size: 14px; font-weight: bold;");
        
        playNotificationSound();

        // Non-blocking toast notification so Electron UI & hCaptcha modal are never blocked
        showToast(`🎉 Quest 100%: ${questName}`, "Open Discord Quests / Gift Inventory, click 'Claim Reward' and solve captcha. Next quest starts automatically!");

        return new Promise((resolve) => {
            let claimListener = (data) => {
                if (data.questId === quest.id) {
                    cleanup();
                    resolve();
                }
            };

            let pollInterval = setInterval(() => {
                const liveQuest = QuestsStore.getQuest ? QuestsStore.getQuest(quest.id) : (QuestsStore.quests instanceof Map ? QuestsStore.quests.get(quest.id) : QuestsStore.quests?.[quest.id]);
                const uStatus = liveQuest?.userStatus || liveQuest?.user_status;
                if (uStatus?.claimedAt || uStatus?.claimed_at) {
                    cleanup();
                    resolve();
                }
            }, 2500);

            function cleanup() {
                clearInterval(pollInterval);
                try { FluxDispatcher.unsubscribe("QUESTS_CLAIM_REWARD_SUCCESS", claimListener); } catch (e) {}
                console.log(`%c🏆 [${questName}] Reward claim detected! Advancing queue...`, "color: #57F287; font-weight: bold;");
            }

            try { FluxDispatcher.subscribe("QUESTS_CLAIM_REWARD_SUCCESS", claimListener); } catch (e) {}
        });
    }

    // Single quest execution wrapper
    async function executeQuest(quest) {
        normalizeQuest(quest);
        const questName = quest.config?.messages?.questName || "Quest";

        // Double check auto-enrollment before running tasks
        const isEnrolled = !!(quest.userStatus?.enrolledAt || quest.userStatus?.enrolled_at);
        if (!isEnrolled) {
            await enrollInQuest(quest);
        }

        return new Promise((resolve) => {
            try {
                const pid = Math.floor(Math.random() * 30000) + 1000;
                const taskConfig = quest.config.taskConfig || quest.config.taskConfigV2 || quest.config.task_config || quest.config.task_config_v2;
                const taskName = supportedTasks.find(x => taskConfig?.tasks?.[x] != null);
                const taskData = taskConfig?.tasks?.[taskName];

                if (!taskName || !taskData) {
                    console.warn(`[${questName}] Unknown or unsupported task format.`);
                    return resolve();
                }

                const applicationId = quest.config.application?.id ?? taskData.applications?.[0]?.id;
                const secondsNeeded = taskData.target;
                const uStatus = quest.userStatus || quest.user_status;
                let secondsDone = uStatus?.progress?.[taskName]?.value ?? 0;

                // If already reached 100% but not claimed
                const isCompleted = !!(uStatus?.completedAt || uStatus?.completed_at);
                if (secondsDone >= secondsNeeded || isCompleted) {
                    waitForUserToClaimReward(quest).then(() => resolve());
                    return;
                }

                // 1. VIDEO QUESTS (Natural 1x real-time speed)
                if (taskName === "WATCH_VIDEO" || taskName === "WATCH_VIDEO_ON_MOBILE") {
                    let fn = async () => {
                        console.log(`%c[${questName}] 📺 Playing video at natural 1x speed (anti-ban timing)...`, "color: #00B0F4;");
                        while (secondsDone < secondsNeeded) {
                            const stepSeconds = Math.min(5 + Math.floor(Math.random() * 3), secondsNeeded - secondsDone);
                            await new Promise(r => setTimeout(r, stepSeconds * 1000));
                            secondsDone = Math.min(secondsNeeded, secondsDone + stepSeconds);

                            const res = await api.post({
                                url: `/quests/${quest.id}/video-progress`,
                                body: { timestamp: secondsDone }
                            });

                            console.log(`%c⏱ [${questName}] Video progress: ${secondsDone}/${secondsNeeded}s`, "color: #FEE75C;");
                            if (res.body?.completed_at != null || secondsDone >= secondsNeeded) {
                                break;
                            }
                        }
                        console.log(`%c✅ [${questName}] Video completed!`, "color: #57F287; font-weight: bold;");
                        await waitForUserToClaimReward(quest);
                        resolve();
                    };
                    fn().catch(e => {
                        console.log(`[${questName}] Video error:`, e?.message || e);
                        resolve();
                    });

                // 2. DESKTOP GAME QUESTS
                } else if (taskName === "PLAY_ON_DESKTOP") {
                    if (!isApp) {
                        console.warn(`[${questName}] Desktop game quests require the Discord Desktop App.`);
                        return resolve();
                    }

                    api.get({url: `/applications/public?application_ids=${applicationId}`}).then(res => {
                        const appData = res.body?.[0];
                        const appName = appData?.name ?? quest.config.application?.name ?? "Game";
                        const exeName = appData?.executables?.find(x => x.os === "win32")?.name?.replace(">", "") ?? (appName.replace(/[\/\\:*?"<>|]/g, "") + ".exe");

                        const fakeGame = {
                            cmdLine: `C:\\Program Files\\${appName}\\${exeName}`,
                            exeName: exeName,
                            exePath: `c:/program files/${appName.toLowerCase()}/${exeName}`,
                            hidden: false,
                            isLauncher: false,
                            id: applicationId,
                            name: appName,
                            pid: pid,
                            pidPath: [pid],
                            processName: appName,
                            start: Date.now(),
                        };

                        activeFakeGames.set(applicationId, fakeGame);
                        updateGamesDispatch();

                        console.log(`%c🎮 [${questName}] '${appName}' is active! Discord heartbeat sending every 20s (~${Math.ceil((secondsNeeded - secondsDone) / 60)}m left)...`, "color: #00B0F4; font-weight: bold;");

                        let fn = async (data) => {
                            if (data.questId !== quest.id) return;
                            const status = data.userStatus || data.user_status;
                            let progress = 0;
                            if (status?.progress?.PLAY_ON_DESKTOP?.value != null) {
                                progress = Math.floor(status.progress.PLAY_ON_DESKTOP.value);
                            } else if (status?.streamProgressSeconds != null) {
                                progress = status.streamProgressSeconds;
                            } else if (status?.stream_progress_seconds != null) {
                                progress = status.stream_progress_seconds;
                            }

                            const mins = Math.floor(progress / 60);
                            const secs = progress % 60;
                            console.log(`%c⏱ [${questName}] Progress: ${mins}:${secs < 10 ? '0' : ''}${secs} / ${Math.floor(secondsNeeded / 60)}:00 (${progress}/${secondsNeeded}s)`, "color: #FEE75C;");

                            if (progress >= secondsNeeded) {
                                console.log(`%c🎉 [${questName}] Quest reached 100%!`, "color: #57F287; font-size: 14px; font-weight: bold;");
                                activeFakeGames.delete(applicationId);

                                if (activeFakeGames.size > 0) {
                                    updateGamesDispatch();
                                } else {
                                    RunningGameStore.getRunningGames = originalGetRunningGames;
                                    RunningGameStore.getGameForPID = originalGetGameForPID;
                                    FluxDispatcher.dispatch({type: "RUNNING_GAMES_CHANGE", removed: [fakeGame], added: [], games: []});
                                }

                                FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn);
                                await waitForUserToClaimReward(quest);
                                resolve();
                            }
                        };
                        FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn);
                    }).catch(e => {
                        console.log(`[${questName}] Game error:`, e?.message || e);
                        resolve();
                    });

                // 3. STREAM QUESTS
                } else if (taskName === "STREAM_ON_DESKTOP") {
                    if (!isApp) return resolve();
                    let realFunc = ApplicationStreamingStore.getStreamerActiveStreamMetadata;
                    ApplicationStreamingStore.getStreamerActiveStreamMetadata = () => ({
                        id: applicationId,
                        pid: pid,
                        sourceName: null
                    });

                    let fn = async (data) => {
                        if (data.questId !== quest.id) return;
                        const status = data.userStatus || data.user_status;
                        let progress = 0;
                        if (status?.progress?.STREAM_ON_DESKTOP?.value != null) {
                            progress = Math.floor(status.progress.STREAM_ON_DESKTOP.value);
                        } else if (status?.streamProgressSeconds != null) {
                            progress = status.streamProgressSeconds;
                        } else if (status?.stream_progress_seconds != null) {
                            progress = status.stream_progress_seconds;
                        }
                        console.log(`[${questName}] Stream progress: ${progress}/${secondsNeeded}s`);

                        if (progress >= secondsNeeded) {
                            ApplicationStreamingStore.getStreamerActiveStreamMetadata = realFunc;
                            FluxDispatcher.unsubscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn);
                            await waitForUserToClaimReward(quest);
                            resolve();
                        }
                    };
                    FluxDispatcher.subscribe("QUESTS_SEND_HEARTBEAT_SUCCESS", fn);
                    console.log(`[${questName}] Stream spoofing active. Stream any window in a voice channel.`);

                // 4. ACTIVITY QUESTS
                } else if (taskName === "PLAY_ACTIVITY") {
                    let channelId = ChannelStore.getSortedPrivateChannels()[0]?.id ?? Object.values(GuildChannelStore.getAllGuilds()).find(x => x != null && x.VOCAL?.length > 0)?.VOCAL[0]?.channel.id;
                    if (!channelId) {
                        console.log(`[${questName}] No voice channel found. Skipping activity safely.`);
                        return resolve();
                    }

                    const streamKey = `call:${channelId}:1`;
                    let fn = async () => {
                        while (true) {
                            const res = await api.post({url: `/quests/${quest.id}/heartbeat`, body: {stream_key: streamKey, terminal: false}});
                            const progress = res.body?.progress?.PLAY_ACTIVITY?.value ?? 0;
                            console.log(`[${questName}] Activity progress: ${progress}/${secondsNeeded}s`);

                            if (progress >= secondsNeeded) {
                                await api.post({url: `/quests/${quest.id}/heartbeat`, body: {stream_key: streamKey, terminal: true}});
                                break;
                            }
                            await new Promise(r => setTimeout(r, 20 * 1000));
                        }
                        await waitForUserToClaimReward(quest);
                        resolve();
                    };
                    fn().catch(() => resolve());
                } else {
                    resolve();
                }
            } catch (e) {
                resolve();
            }
        });
    }

    // Queue worker engine: runs at most MAX_CONCURRENT tasks simultaneously
    async function worker(workerId) {
        while (queue.length > 0) {
            const nextQuest = queue.shift();
            normalizeQuest(nextQuest);
            const qName = nextQuest.config?.messages?.questName || "Quest";
            console.log(`%c[Worker #${workerId}] 🚀 Starting quest: '${qName}' (${queue.length} remaining in queue)`, "color: #5865F2; font-weight: bold;");
            await executeQuest(nextQuest);
            // Brief natural pause (3 seconds) between quests
            await new Promise(r => setTimeout(r, 3000));
        }
    }

    const workerCount = Math.min(MAX_CONCURRENT, allQuests.length);
    const workerPromises = [];
    for (let i = 1; i <= workerCount; i++) {
        workerPromises.push(worker(i));
    }

    await Promise.all(workerPromises);
    showToast("🎉 All Quests Done!", "All quests have been completed and claimed! Great job!");
})();
