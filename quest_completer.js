/**
 * Discord Quest Parallel Auto-Completer (Captcha-Safe Queue Engine)
 * 
 * Features:
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

    const supportedTasks = ["WATCH_VIDEO", "WATCH_VIDEO_ON_MOBILE", "PLAY_ON_DESKTOP", "STREAM_ON_DESKTOP", "PLAY_ACTIVITY"];
    const isApp = typeof DiscordNative !== "undefined";
    const now = Date.now();

    // Fetch active quests that are not yet claimed
    let allQuests = [...QuestsStore.quests.values()].filter(x => {
        if (!x?.config) return false;
        const exp = new Date(x.config.expiresAt).getTime();
        if (exp <= now) return false;
        if (x.userStatus?.claimedAt) return false;
        const taskCfg = x.config.taskConfig ?? x.config.taskConfigV2;
        if (!taskCfg?.tasks) return false;
        return supportedTasks.some(t => Object.keys(taskCfg.tasks).includes(t));
    });

    if (allQuests.length === 0) {
        alert("🎉 All available quests are already completed and claimed!");
        return;
    }

    // Auto-enroll in all available quests
    for (const q of allQuests) {
        if (!q.userStatus?.enrolledAt) {
            const qName = q.config.messages?.questName ?? "Quest";
            try {
                console.log(`%c[Safe Quest Completer] Enrolling in '${qName}'...`, "color: #FEE75C;");
                await api.post({url: `/quests/${q.id}/enroll`, body: {location: 1}});
            } catch (e) {}
        }
    }

    const MAX_CONCURRENT = 2; // Maximum 2 active quests at a time for safety
    const queue = [...allQuests];
    const totalCount = queue.length;

    console.log(`%c🛡️ [Safe Quest Completer] Loaded ${totalCount} quest(s). Max ${MAX_CONCURRENT} active at a time. Manual captcha-safe claiming enabled.`, "color: #57F287; font-size: 14px; font-weight: bold;");

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
        const questName = quest.config.messages?.questName ?? quest.id;
        console.log(`%c🔔 [${questName}] 100% COMPLETE! Waiting for user to claim reward & solve captcha in Discord...`, "color: #57F287; font-size: 14px; font-weight: bold;");
        
        playNotificationSound();

        // Inform user via alert
        alert(`🎉 Quest Completed (100%): [${questName}]!\n\n👉 Please open your Discord Quests tab, click 'Claim Reward' and solve the captcha.\n\nOnce you claim it, the script will automatically detect it and launch the next quest from the queue!`);

        return new Promise((resolve) => {
            let claimListener = (data) => {
                if (data.questId === quest.id) {
                    cleanup();
                    resolve();
                }
            };

            let pollInterval = setInterval(() => {
                const liveQuest = QuestsStore.getQuest ? QuestsStore.getQuest(quest.id) : QuestsStore.quests?.get(quest.id);
                if (liveQuest?.userStatus?.claimedAt) {
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
    function executeQuest(quest) {
        return new Promise((resolve) => {
            try {
                const pid = Math.floor(Math.random() * 30000) + 1000;
                const questName = quest.config.messages?.questName ?? "Quest";
                const taskConfig = quest.config.taskConfig ?? quest.config.taskConfigV2;
                const taskName = supportedTasks.find(x => taskConfig.tasks[x] != null);
                const taskData = taskConfig.tasks[taskName];

                const applicationId = quest.config.application?.id ?? taskData.applications?.[0]?.id;
                const secondsNeeded = taskData.target;
                let secondsDone = quest.userStatus?.progress?.[taskName]?.value ?? 0;

                // If already reached 100% but not claimed
                if (secondsDone >= secondsNeeded || quest.userStatus?.completedAt) {
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
                            let progress = quest.config.configVersion === 1 
                                ? data.userStatus.streamProgressSeconds 
                                : Math.floor(data.userStatus.progress.PLAY_ON_DESKTOP.value);

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
                        let progress = quest.config.configVersion === 1 ? data.userStatus.streamProgressSeconds : Math.floor(data.userStatus.progress.STREAM_ON_DESKTOP.value);
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
            const qName = nextQuest.config.messages?.questName ?? "Quest";
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
    alert("🎉 All quests have been completed and claimed! Great job!");
})();
