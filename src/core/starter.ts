// Диаграмма для нового проекта.
export const STARTER = `sequenceDiagram
    title Вход в приложение
    actor user as Пользователь
    participant app as Приложение<br/>браузер
    participant api as Сервер
    participant db@{ "type" : "database" } as База
    %% == 1. Вход ==
    user->>app: Вводит логин и пароль
    app->>+api: POST /login<br/>login, password
    api->>db: Найти пользователя
    db-->>api: Пользователь
    alt пароль верный
        api-->>app: 200 OK<br/>access_token
        app-->>user: Главный экран
    else ошибка
        api-->>app: 401 Unauthorized
        app-->>user: Неверный пароль
    end
    deactivate api
    %% == 2. Запрос данных ==
    app->>api: GET /profile<br/>Bearer access_token
    api-->>app: Профиль
    Note over user,app: Данные на экране
`;
