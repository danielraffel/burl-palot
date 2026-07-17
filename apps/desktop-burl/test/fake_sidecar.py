#!/usr/bin/env python3
import json
import os
import sys
import time


def lifecycle(value):
    path = os.environ.get("PALOT_FAKE_LIFECYCLE_LOG")
    if path:
        with open(path, "a", encoding="utf-8") as output:
            output.write(value + "\n")


def send(value):
    print(json.dumps(value, separators=(",", ":")), flush=True)


lifecycle("sidecar.start")
send({"version": 1, "type": "ready", "pid": 42})
project_id = "project-1"
session_id = "session-1"
project_directory = ""
for line in sys.stdin:
    value = json.loads(line)
    frame_type = value["type"]
    if frame_type == "shutdown":
        lifecycle("sidecar.shutdown")
        send({"version": 1, "type": "shutdown", "id": value["id"]})
        break
    if frame_type == "subscribe":
        lifecycle("events.subscribe")
        send({"version": 1, "type": "subscribed", "id": value["id"], "subscriptionId": value["id"]})
        continue
    if frame_type != "command":
        continue
    command = value["command"]
    command_type = command["type"]
    lifecycle(command_type)
    if command_type == "server.start":
        project_directory = command["directory"]
        result = {"ok": True, "value": {"baseUrl": "http://127.0.0.1", "directory": command["directory"], "ownedProcess": True}}
    elif command_type == "project.select":
        project_directory = command["directory"]
        result = {"ok": True, "value": {"id": project_id, "directory": command["directory"], "name": "fixture"}}
    elif command_type in ("session.create", "session.open"):
        result = {"ok": True, "value": {"id": session_id}}
    elif command_type == "session.fork":
        session_id = "session-forked"
        result = {"ok": True, "value": {"id": session_id}}
    elif command_type == "session.revert":
        result = {"ok": True, "value": {"sessionID": session_id, "messageID": command["messageId"]}}
    elif command_type in ("prompt.send", "prompt.retry"):
        prompt_log = os.environ.get("PALOT_FAKE_PROMPT_LOG")
        if prompt_log:
            with open(prompt_log, "a", encoding="utf-8") as output:
                output.write(json.dumps(command, separators=(",", ":")) + "\n")
        result = {"ok": True, "value": {"requestId": command["requestId"], "sessionId": session_id}}
    elif command_type == "prompt.cancel":
        if project_directory == "/tmp/close-on-cancel":
            os._exit(0)
        if project_directory == "/tmp/delayed-cancel":
            for event_type in ("session.error", "session.idle"):
                send({
                    "version": 1,
                    "type": "event",
                    "subscriptionId": "1-events",
                    "event": {"projectId": project_id, "sessionId": session_id, "payload": {
                        "type": "sdk.event",
                        "event": {"type": event_type, "properties": {"sessionID": session_id}},
                    }},
                })
            time.sleep(0.2)
        result = {"ok": True, "value": {"requestId": command["requestId"], "cancelled": True}}
    else:
        result = {"ok": False, "error": {"message": "unsupported fixture command"}}
    send({"version": 1, "type": "response", "id": value["id"], "result": result})
    if command_type in ("prompt.send", "prompt.retry"):
        if project_directory == "/tmp/oversize":
            send({"version": 1, "type": "event", "padding": "x" * 2048})
            continue
        send({
            "version": 1,
            "type": "event",
            "subscriptionId": "1-events",
            "event": {"projectId": project_id, "sessionId": session_id, "payload": {
                "type": "sdk.event",
                "event": {"type": "sync", "syncEvent": {"aggregateID": session_id}},
            }},
        })
        send({
            "version": 1,
            "type": "event",
            "subscriptionId": "1-events",
            "event": {"projectId": project_id, "sessionId": session_id, "payload": {
                "type": "sdk.event",
                "event": {"type": "message.updated", "properties": {"info": {
                    "id": "user-message-1", "sessionID": session_id, "role": "user",
                }}},
            }},
        })
        send({
            "version": 1,
            "type": "event",
            "subscriptionId": "1-events",
            "event": {"projectId": project_id, "sessionId": session_id, "payload": {
                "type": "sdk.event",
                "event": {"type": "message.updated", "properties": {"info": {
                    "id": "assistant-message-1", "sessionID": session_id, "role": "assistant",
                    "parentID": "user-message-1",
                }}},
            }},
        })
        send({
            "version": 1,
            "type": "event",
            "subscriptionId": "1-events",
            "event": {"payload": {"type": "sdk.event", "event": {
                "type": "message.part.updated",
                "properties": {"part": {"id": "reason-1", "messageID": "assistant-message-1", "type": "reasoning", "text": ""}},
            }}},
        })
        send({
            "version": 1,
            "type": "event",
            "subscriptionId": "1-events",
            "event": {"payload": {"type": "sdk.event", "event": {
                "type": "message.part.delta",
                "properties": {"sessionID": session_id, "messageID": "assistant-message-1", "partID": "reason-1", "field": "text", "delta": "private reasoning"},
            }}},
        })
        send({
            "version": 1,
            "type": "event",
            "subscriptionId": "1-events",
            "event": {"payload": {"type": "sdk.event", "event": {
                "type": "message.part.updated",
                "properties": {"part": {"id": "reason-1", "messageID": "assistant-message-1", "type": "reasoning",
                    "state": {"time": {"start": 1000, "end": 3000}}}},
            }}},
        })
        send({
            "version": 1,
            "type": "event",
            "subscriptionId": "1-events",
            "event": {"payload": {"type": "sdk.event", "event": {
                "type": "message.part.updated",
                "properties": {"part": {"id": "text-1", "messageID": "assistant-message-1", "type": "text", "text": ""}},
            }}},
        })
        send({
            "version": 1,
            "type": "event",
            "subscriptionId": "1-events",
            "event": {"payload": {"type": "sdk.event", "event": {
                "type": "message.part.delta",
                "properties": {"sessionID": session_id, "messageID": "assistant-message-1", "partID": "text-1", "field": "text", "delta": "fixture response"},
            }}},
        })
        if project_directory in ("/tmp/close-on-cancel", "/tmp/delayed-cancel"):
            continue
        send({
            "version": 1,
            "type": "event",
            "subscriptionId": "1-events",
            "event": {"payload": {"type": "sdk.event", "event": {
                "type": "message.part.updated",
                "properties": {"part": {"id": "tool-1", "messageID": "assistant-message-1", "type": "tool", "tool": "read",
                    "state": {"status": "running", "input": {"path": "src/lib/theme.ts"},
                              "time": {"start": 1000}}}},
            }}},
        })
        send({
            "version": 1,
            "type": "event",
            "subscriptionId": "1-events",
            "event": {"payload": {"type": "sdk.event", "event": {
                "type": "message.part.updated",
                "properties": {"part": {"id": "tool-1", "messageID": "assistant-message-1", "type": "tool", "tool": "read",
                    "state": {"status": "completed", "input": {"path": "src/lib/theme.ts"},
                              "time": {"start": 1000, "end": 4000}, "output": "ok"}}},
            }}},
        })
        send({
            "version": 1,
            "type": "event",
            "subscriptionId": "1-events",
            "event": {"payload": {"type": "sdk.event", "event": {
                "type": "session.idle",
                "properties": {"sessionID": session_id},
            }}},
        })
