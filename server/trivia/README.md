# Trivia question packs

Each `.json` file here is one pack of questions for Fireside Trivia. The server loads every pack when it starts.

```json
{
  "name": "Pack name",
  "credit": "Shown in the game when its questions are in play (leave empty for none)",
  "questions": [
    { "id": "pk-unique-id", "c": "Category", "d": "easy|medium|hard", "q": "The question?", "a": "Right answer", "w": ["Wrong", "Wrong", "Wrong"] }
  ]
}
```

- `id` must be unique across every pack and never change: each hearth remembers which ids it has seen.
- True or false questions have `"tf": true`, `"a": "True"` or `"False"`, and one wrong answer.
- To add questions, add a new pack (or add to the end of one) in a pull request.

`opentdb.json` comes from [Open Trivia DB](https://opentdb.com/) (via a public export of its verified questions), licensed CC BY-SA 4.0. The game credits it.
