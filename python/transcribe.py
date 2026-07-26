#!/usr/bin/env python3

import json
import os
import sys
from typing import Any

from vosk import KaldiRecognizer, Model, SetLogLevel


SAMPLE_RATE = 16000
MODEL_PATH = os.path.join(
    os.getcwd(),
    "models",
    "vosk-model-small-tr-0.3",
)

# Node tarafı sesi bu büyüklükte parçalar halinde gönderebilir.
READ_CHUNK_SIZE = 8000


def write_json(payload: dict[str, Any]) -> None:
    """
    Node.js tarafının okuyabilmesi için her sonucu
    tek satırlık JSON olarak stdout'a gönderir.
    """
    sys.stdout.write(
        json.dumps(
            payload,
            ensure_ascii=False,
        )
        + "\n"
    )
    sys.stdout.flush()


def write_error(message: str) -> None:
    write_json(
        {
            "type": "error",
            "message": message,
        }
    )


def main() -> int:
    # Vosk'un ayrıntılı terminal loglarını kapatır.
    SetLogLevel(-1)

    if not os.path.isdir(MODEL_PATH):
        write_error(
            f"Vosk model klasörü bulunamadı: {MODEL_PATH}"
        )
        return 1

    try:
        model = Model(MODEL_PATH)

        recognizer = KaldiRecognizer(
            model,
            SAMPLE_RATE,
        )

        # Sonuçlarda kelime ayrıntılarını açar.
        recognizer.SetWords(True)

        write_json(
            {
                "type": "ready",
                "sample_rate": SAMPLE_RATE,
                "model_path": MODEL_PATH,
            }
        )

        while True:
            audio_chunk = sys.stdin.buffer.read(
                READ_CHUNK_SIZE
            )

            if not audio_chunk:
                break

            if recognizer.AcceptWaveform(
                audio_chunk
            ):
                result = json.loads(
                    recognizer.Result()
                )

                text = str(
                    result.get("text", "")
                ).strip()

                words = result.get("result", [])

                confidences = [
                    float(word.get("conf", 0.0))
                    for word in words
                    if isinstance(word, dict)
                ]

                average_confidence = (
                    sum(confidences)
                    / len(confidences)
                    if confidences
                    else 0.0
                )

                if text:
                    write_json(
                        {
                            "type": "final",
                            "text": text,
                            "confidence": round(
                                average_confidence,
                                4,
                            ),
                            "words": words,
                        }
                    )

        final_result = json.loads(
            recognizer.FinalResult()
        )

        final_text = str(
            final_result.get("text", "")
        ).strip()

        final_words = final_result.get(
            "result",
            [],
        )

        final_confidences = [
            float(word.get("conf", 0.0))
            for word in final_words
            if isinstance(word, dict)
        ]

        final_average_confidence = (
            sum(final_confidences)
            / len(final_confidences)
            if final_confidences
            else 0.0
        )

        if final_text:
            write_json(
                {
                    "type": "final",
                    "text": final_text,
                    "confidence": round(
                        final_average_confidence,
                        4,
                    ),
                    "words": final_words,
                }
            )

        write_json(
            {
                "type": "closed",
            }
        )

        return 0

    except KeyboardInterrupt:
        write_json(
            {
                "type": "closed",
                "reason": "keyboard_interrupt",
            }
        )
        return 0

    except Exception as error:
        write_error(
            f"{type(error).__name__}: {error}"
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())